/* Protocol meta info:
<NAME> Wiegand </NAME>
<DESCRIPTION>
Wiegand interface decoder (two-wire DATA0/DATA1) used by RFID/proximity card readers and
access-control systems. Decodes the standard 26-bit format (facility code, card number,
even/odd parity validation) and falls back to a raw value + bit count for any other length.
</DESCRIPTION>
<VERSION> 0.1 </VERSION>
<AUTHOR_NAME> Ibrahim KAMAL </AUTHOR_NAME>
<AUTHOR_URL> i.kamal@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright Ibrahim KAMAL </COPYRIGHT>
<LICENSE>  This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.1: Initial release. 26-bit decode + raw fallback, demo mode, packet view.
</RELEASE_NOTES>
*/

/*
  Define decoder configuration GUI
*/
function on_draw_gui_decoder()
{
    ScanaStudio.gui_add_ch_selector("ch_d0", "Data 0 (D0) line", "D0");
    ScanaStudio.gui_add_ch_selector("ch_d1", "Data 1 (D1) line", "D1");

    ScanaStudio.gui_add_combo_box("disp_format", "Display format");
    ScanaStudio.gui_add_item_to_combo_box("HEX", true);
    ScanaStudio.gui_add_item_to_combo_box("Decimal", false);
    ScanaStudio.gui_add_item_to_combo_box("Binary", false);

    ScanaStudio.gui_add_new_tab("Advanced options", false);
    ScanaStudio.gui_add_text_input("inter_frame_ms", "New-frame idle gap (ms)", "2");
    ScanaStudio.gui_add_info_label("A gap between pulses larger than this value starts a new frame.");
    ScanaStudio.gui_add_check_box("active_low", "Pulses are active-low (lines idle high)", true);
    ScanaStudio.gui_end_tab();
}

//Evaluate decoder GUI
function on_eval_gui_decoder()
{
    if (Number(ScanaStudio.gui_get_value("ch_d0")) == Number(ScanaStudio.gui_get_value("ch_d1")))
    {
        return "Data 0 and Data 1 must be assigned to different channels.";
    }
    var gap = Number(ScanaStudio.gui_get_value("inter_frame_ms"));
    if (isNaN(gap) || gap <= 0)
    {
        return "New-frame idle gap must be a positive number of milliseconds.";
    }
    return ""; //All good.
}

function reload_dec_gui_values()
{
    ch_d0 = Number(ScanaStudio.gui_get_value("ch_d0"));
    ch_d1 = Number(ScanaStudio.gui_get_value("ch_d1"));
    disp_format = Number(ScanaStudio.gui_get_value("disp_format"));
    active_low = ScanaStudio.gui_get_value("active_low");

    var gap_ms = Number(ScanaStudio.gui_get_value("inter_frame_ms"));
    if (isNaN(gap_ms) || gap_ms <= 0) gap_ms = 2;

    sampling_rate = ScanaStudio.get_capture_sample_rate();
    inter_frame_samples = (gap_ms / 1000) * sampling_rate;

    idle_level   = active_low ? 1 : 0;
    active_level = active_low ? 0 : 1;
}

//Global variables
var sampling_rate;
var ch_d0, ch_d1;
var disp_format = 0;
var active_low = true;
var inter_frame_samples = 0;
var idle_level = 1;
var active_level = 0;

var dbg = false; //set to true to print decoding traces to the script console

//Per-channel transition iterators.
//trs_dX holds the next transition to process on that line; dX_consumed means it
//has already been processed and a fresh one must be fetched before processing again.
var trs_d0, trs_d1;
var d0_consumed, d1_consumed;
var pulse_start_d0, pulse_start_d1; //sample index where a pulse went active (-1 = none pending)

//Current frame accumulator
var frame_items;        //array of {ch, st, end, value}
var frame_start;
var last_leading_sample;
var last_trailing_sample;

function reset_frame()
{
    frame_items = [];
    frame_start = -1;
    last_leading_sample = -1;
}

function on_decode_signals(resume)
{
    if (!resume)
    {
        reload_dec_gui_values();

        ScanaStudio.trs_reset(ch_d0);
        ScanaStudio.trs_reset(ch_d1);
        trs_d0 = ScanaStudio.trs_get_next(ch_d0);
        trs_d1 = ScanaStudio.trs_get_next(ch_d1);
        d0_consumed = false;
        d1_consumed = false;
        pulse_start_d0 = -1;
        pulse_start_d1 = -1;
        last_trailing_sample = 0;
        reset_frame();
        if (dbg) ScanaStudio.console_info_msg("Wiegand decoding started");
    }
    else if (dbg)
    {
        ScanaStudio.console_info_msg("Wiegand decoding resumed");
    }

    while (ScanaStudio.abort_is_requested() == false)
    {
        //Refill any consumed line with the next transition, if one is available
        //in the currently captured data. This is re-evaluated on every (resume)
        //call, so streaming/live decoding continues without needing a relaunch.
        if (d0_consumed && ScanaStudio.trs_is_not_last(ch_d0))
        {
            trs_d0 = ScanaStudio.trs_get_next(ch_d0);
            d0_consumed = false;
        }
        if (d1_consumed && ScanaStudio.trs_is_not_last(ch_d1))
        {
            trs_d1 = ScanaStudio.trs_get_next(ch_d1);
            d1_consumed = false;
        }

        var a0 = !d0_consumed;
        var a1 = !d1_consumed;

        if (!a0 && !a1)
        {
            //No transition currently available on either line. If a full
            //inter-frame idle gap has elapsed after the last bit, the pending
            //frame is complete (this also flushes the last frame at end of
            //capture, since Wiegand has no explicit end marker). Then break and
            //wait for more samples (a resume call) or end of capture.
            flush_if_idle_gap_elapsed();
            break;
        }

        //Process the earlier of the available transitions. When only one line
        //has data, it is safe to process it: any future transition on the other
        //line is necessarily at a higher (not-yet-captured) sample index.
        if (a0 && (!a1 || (trs_d0.sample_index <= trs_d1.sample_index)))
        {
            process_transition(ch_d0, trs_d0, false);
            d0_consumed = true;
        }
        else
        {
            process_transition(ch_d1, trs_d1, true);
            d1_consumed = true;
        }
    }
}

/*
  Close the pending frame once enough idle time has elapsed after its last bit.
*/
function flush_if_idle_gap_elapsed()
{
    if (!frame_items || frame_items.length == 0) return;
    var avail = ScanaStudio.get_available_samples(ch_d0);
    if (avail >= 0 && (avail - last_trailing_sample) > inter_frame_samples)
    {
        if (dbg) ScanaStudio.console_info_msg("Flushing frame on idle gap", last_trailing_sample);
        finalize_frame();
    }
}

/*
  Handle one transition on a single line.
  is_d1 = true when this is the DATA1 line (carries logical '1' bits).
*/
function process_transition(ch, tr, is_d1)
{
    if (tr.value == active_level)
    {
        //Leading (going-active) edge => one captured bit.
        //Close any previous frame if the idle gap is too large.
        if (frame_items.length > 0 && (tr.sample_index - last_leading_sample) > inter_frame_samples)
        {
            finalize_frame();
        }

        if (frame_items.length == 0)
        {
            frame_start = tr.sample_index;
        }

        last_leading_sample = tr.sample_index;
        if (is_d1) pulse_start_d1 = tr.sample_index;
        else       pulse_start_d0 = tr.sample_index;
    }
    else
    {
        //Trailing (going-idle) edge => close the pulse and register the bit.
        var st = is_d1 ? pulse_start_d1 : pulse_start_d0;
        if (st >= 0)
        {
            frame_items.push({
                ch: ch,
                st: st,
                end: tr.sample_index,
                value: is_d1 ? 1 : 0
            });
            last_trailing_sample = tr.sample_index;
            if (is_d1) pulse_start_d1 = -1;
            else       pulse_start_d0 = -1;
        }
    }
}

/*
  Render the accumulated frame: per-bit decode items + packet view.
*/
function finalize_frame()
{
    if (!frame_items || frame_items.length == 0) return;

    var bit_count = frame_items.length;
    var frame_end = frame_items[bit_count - 1].end;

    //Build the bit array (MSB first = first received bit).
    var bits = [];
    for (var i = 0; i < bit_count; i++) bits.push(frame_items[i].value);

    //26-bit standard format interpretation.
    var is_26 = (bit_count == 26);
    var even_ok = true, odd_ok = true;
    var facility = 0, card = 0;

    if (is_26)
    {
        //Even parity: bit0 covers data bits 1..12  => ones in bits[0..12] must be even.
        var ones_lead = 0;
        for (var a = 0; a <= 12; a++) ones_lead += bits[a];
        even_ok = ((ones_lead % 2) == 0);

        //Odd parity: bit25 covers data bits 13..24 => ones in bits[13..25] must be odd.
        var ones_trail = 0;
        for (var b = 13; b <= 25; b++) ones_trail += bits[b];
        odd_ok = ((ones_trail % 2) == 1);

        facility = bits_to_int(bits, 1, 8);   //bits 1..8
        card     = bits_to_int(bits, 9, 24);  //bits 9..24
    }

    //--- Decode items (drawn now so parity errors can be emphasized) ---
    for (var k = 0; k < bit_count; k++)
    {
        var it = frame_items[k];
        ScanaStudio.dec_item_new(it.ch, it.st, it.end);

        if (is_26 && k == 0)
        {
            ScanaStudio.dec_item_add_content("Even parity (" + it.value + ")");
            ScanaStudio.dec_item_add_content("PE:" + it.value);
            ScanaStudio.dec_item_add_content(it.value.toString());
            if (!even_ok) ScanaStudio.dec_item_emphasize_error();
        }
        else if (is_26 && k == 25)
        {
            ScanaStudio.dec_item_add_content("Odd parity (" + it.value + ")");
            ScanaStudio.dec_item_add_content("PO:" + it.value);
            ScanaStudio.dec_item_add_content(it.value.toString());
            if (!odd_ok) ScanaStudio.dec_item_emphasize_error();
        }
        else
        {
            ScanaStudio.dec_item_add_content(it.value.toString());
        }

        ScanaStudio.dec_item_add_sample_point(it.st, it.value);
        ScanaStudio.dec_item_end();
    }

    //--- Packet view ---
    if (is_26)
    {
        var parity_ok = even_ok && odd_ok;
        ScanaStudio.packet_view_add_packet(true, ch_d0, frame_start, frame_end,
            "Wiegand", "26-bit" + (parity_ok ? "" : " (parity error)"),
            ScanaStudio.PacketColors.Head.Title, ScanaStudio.PacketColors.Head.Content);

        ScanaStudio.packet_view_add_packet(false, ch_d0, frame_items[1].st, frame_items[8].end,
            "Facility code", fmt_value(facility, 8),
            ScanaStudio.PacketColors.Data.Title, ScanaStudio.PacketColors.Data.Content);

        ScanaStudio.packet_view_add_packet(false, ch_d0, frame_items[9].st, frame_items[24].end,
            "Card number", fmt_value(card, 16),
            ScanaStudio.PacketColors.Data.Title, ScanaStudio.PacketColors.Data.Content);

        if (parity_ok)
        {
            ScanaStudio.packet_view_add_packet(false, ch_d0, frame_start, frame_end,
                "Parity", "OK (even+odd)",
                ScanaStudio.PacketColors.Check.Title, ScanaStudio.PacketColors.Check.Content);
        }
        else
        {
            var msg = "FAIL:" + (even_ok ? "" : " even") + (odd_ok ? "" : " odd");
            ScanaStudio.packet_view_add_packet(false, ch_d0, frame_start, frame_end,
                "Parity", msg,
                ScanaStudio.PacketColors.Error.Title, ScanaStudio.PacketColors.Error.Content);
        }
    }
    else
    {
        ScanaStudio.packet_view_add_packet(true, ch_d0, frame_start, frame_end,
            "Wiegand", bit_count + "-bit (raw)",
            ScanaStudio.PacketColors.Head.Title, ScanaStudio.PacketColors.Head.Content);

        ScanaStudio.packet_view_add_packet(false, ch_d0, frame_start, frame_end,
            "Value", fmt_value(bits_to_int(bits, 0, bit_count - 1), bit_count),
            ScanaStudio.PacketColors.Data.Title, ScanaStudio.PacketColors.Data.Content);

        ScanaStudio.packet_view_add_packet(false, ch_d0, frame_start, frame_end,
            "Bits", bit_count.toString(),
            ScanaStudio.PacketColors.Misc.Title, ScanaStudio.PacketColors.Misc.Content);
    }

    reset_frame();
}

/*
  Build an unsigned integer from bits[from..to] inclusive, MSB first.
  Uses multiplication (safe up to 53 bits) to avoid 32-bit bitwise overflow.
*/
function bits_to_int(bits, from, to)
{
    var v = 0;
    for (var i = from; i <= to; i++)
    {
        v = (v * 2) + bits[i];
    }
    return v;
}

/*
  Format a value according to the selected display format.
*/
function fmt_value(value, num_bits)
{
    switch (disp_format)
    {
        case 1: //Decimal
            return value.toString(10);
        case 2: //Binary
            return "0b" + pad(value.toString(2), num_bits);
        default: //HEX
            return "0x" + pad(value.toString(16), Math.ceil(num_bits / 4)).toUpperCase();
    }
}

function pad(str, len)
{
    str = str.toString();
    while (str.length < len) str = "0" + str;
    return str;
}

//Function called to generate demo signals (when no physical device is attached)
function on_build_demo_signals()
{
    var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
    var sample_rate = ScanaStudio.builder_get_sample_rate();
    var d0 = Number(ScanaStudio.gui_get_value("ch_d0"));
    var d1 = Number(ScanaStudio.gui_get_value("ch_d1"));
    var demo_active_low = ScanaStudio.gui_get_value("active_low");

    var demo_idle   = demo_active_low ? 1 : 0;
    var demo_active = demo_active_low ? 0 : 1;

    //Wiegand timing
    var pulse_w   = Math.floor(50e-6  * sample_rate); //~50 us active pulse
    if (pulse_w < 1) pulse_w = 1;
    var bit_period = Math.floor(1e-3  * sample_rate); //~1 ms between bits
    if (bit_period <= pulse_w) bit_period = pulse_w + 1;

    var gap_ms = Number(ScanaStudio.gui_get_value("inter_frame_ms"));
    if (isNaN(gap_ms) || gap_ms <= 0) gap_ms = 2;
    var frame_gap = Math.floor((gap_ms / 1000) * sample_rate) + bit_period;

    //Start both lines idle
    ScanaStudio.builder_add_samples(d0, demo_idle, bit_period);
    ScanaStudio.builder_add_samples(d1, demo_idle, bit_period);

    while (ScanaStudio.builder_get_samples_acc(d0) < samples_to_build)
    {
        if (ScanaStudio.abort_is_requested()) break;

        //Random valid 26-bit frame
        var facility = Math.floor(Math.random() * 256);   //8 bits
        var card     = Math.floor(Math.random() * 65536); //16 bits

        var data = [];
        push_bits(data, facility, 8);
        push_bits(data, card, 16);

        //Even parity over the leading 12 data bits
        var lead_ones = 0;
        for (var a = 0; a < 12; a++) lead_ones += data[a];
        var even_parity = (lead_ones % 2 == 0) ? 0 : 1;

        //Odd parity over the trailing 12 data bits
        var trail_ones = 0;
        for (var b = 12; b < 24; b++) trail_ones += data[b];
        var odd_parity = (trail_ones % 2 == 0) ? 1 : 0;

        var frame = [even_parity].concat(data).concat([odd_parity]); //26 bits

        for (var i = 0; i < frame.length; i++)
        {
            if (frame[i] == 1)
            {
                //Pulse D1, hold D0 idle
                ScanaStudio.builder_add_samples(d1, demo_active, pulse_w);
                ScanaStudio.builder_add_samples(d1, demo_idle, bit_period - pulse_w);
                ScanaStudio.builder_add_samples(d0, demo_idle, bit_period);
            }
            else
            {
                //Pulse D0, hold D1 idle
                ScanaStudio.builder_add_samples(d0, demo_active, pulse_w);
                ScanaStudio.builder_add_samples(d0, demo_idle, bit_period - pulse_w);
                ScanaStudio.builder_add_samples(d1, demo_idle, bit_period);
            }
        }

        //Inter-frame idle gap on both lines
        ScanaStudio.builder_add_samples(d0, demo_idle, frame_gap);
        ScanaStudio.builder_add_samples(d1, demo_idle, frame_gap);
    }
}

//Helper: append the MSB-first bits of value (num_bits wide) to arr.
function push_bits(arr, value, num_bits)
{
    for (var i = num_bits - 1; i >= 0; i--)
    {
        arr.push((value >> i) & 0x1);
    }
}
