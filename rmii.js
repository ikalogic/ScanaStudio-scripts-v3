/* Protocol meta info:
<NAME> RMII </NAME>
<DESCRIPTION>
Reduced Media Independent Interface (RMII) Ethernet frame decoder.
Decodes RX (CRS_DV, RXD[1:0]) and/or TX (TX_EN, TXD[1:0]) frames sampled on REF_CLK,
at 100 Mbps or 10 Mbps, in timing mode (REF_CLK captured on a channel) or state mode
(REF_CLK used as the external sampling clock). Displays preamble, SFD, MAC addresses, 802.1Q tag, EtherType,
payload (with IPv4/ARP summary) and verifies the Ethernet FCS (CRC32).
Frames are counted per direction, with FCS and framing error statistics.
</DESCRIPTION>
<VERSION> 1.0 </VERSION>
<AUTHOR_NAME> Ibrahim KAMAL </AUTHOR_NAME>
<AUTHOR_URL> contact@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright IKALOGIC SAS </COPYRIGHT>
<LICENSE> This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
v1.0: Initial release: RX/TX/dual decoding, 10/100 Mbps, timing and state mode, FCS check, frame counting, demo builder and trigger helper.
</RELEASE_NOTES>
*/

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

var MODE_RX = 0;
var MODE_TX = 1;
var MODE_BOTH = 2;

var SPEED_100M = 0;
var SPEED_10M = 1;

var SAMPLING_TIMING = 0;
var SAMPLING_STATE = 1;

var PAYLOAD_BYTES = 0;
var PAYLOAD_SUMMARY = 1;

var DIBIT_PREAMBLE = 1; // 0x55 sent LSB first: d0=1, d1=0
var DIBIT_SFD_END = 3;  // last dibit of 0xD5

var ETH_MIN_FRAME = 64;     // DA..FCS
var ETH_MAX_FRAME = 1522;   // DA..FCS, 802.1Q tagged
var ETH_HEADER_LEN = 14;
var ETH_FCS_LEN = 4;

var REF_CLK_FREQ = 50e6;

// Demo traffic is generated for this many REF_CLK cycles at most (4 ms at 50 MHz),
// then the lines stay idle: a real 50 MHz clock over a multi-GSa capture would take
// minutes to build and billions of transitions.
var DEMO_MAX_CLOCKS = 200000;

// -----------------------------------------------------------------------------
// Decoder GUI
// -----------------------------------------------------------------------------

function on_get_n_pages_gui_decoder() {
    return 2;
}

function on_draw_gui_decoder(page_number) {
    switch (page_number) {
        case 0:
            ScanaStudio.gui_add_info_label("Step 1: RMII configuration", page_number);

            ScanaStudio.gui_add_combo_box("mode", "Directions to decode", page_number);
            ScanaStudio.gui_add_item_to_combo_box("RX only (CRS_DV, RXD0, RXD1)", true);
            ScanaStudio.gui_add_item_to_combo_box("TX only (TX_EN, TXD0, TXD1)", false);
            ScanaStudio.gui_add_item_to_combo_box("RX and TX", false);

            ScanaStudio.gui_add_combo_box("speed", "Link speed", page_number);
            ScanaStudio.gui_add_item_to_combo_box("100 Mbps (one dibit per REF_CLK cycle)", true);
            ScanaStudio.gui_add_item_to_combo_box("10 Mbps (one dibit every 10 REF_CLK cycles)", false);

            ScanaStudio.gui_add_combo_box("sampling", "Sampling", page_number);
            ScanaStudio.gui_add_item_to_combo_box("Timing mode (REF_CLK captured on a channel)", true);
            ScanaStudio.gui_add_item_to_combo_box("State mode (REF_CLK is the analyzer's external clock, rising edge)", false);

            ScanaStudio.gui_add_separator("", page_number);

            ScanaStudio.gui_add_check_box("show_preamble", "Display preamble as a decoded item", true, page_number);
            ScanaStudio.gui_add_combo_box("payload_display", "Payload display", page_number);
            ScanaStudio.gui_add_item_to_combo_box("One item per byte", true);
            ScanaStudio.gui_add_item_to_combo_box("Single summary item", false);
            ScanaStudio.gui_add_check_box("hex_view", "Send frame bytes to the HEX view", true, page_number);
            break;

        case 1:
            ScanaStudio.gui_add_info_label("Step 2: Channel assignment", page_number);
            mode = ScanaStudio.gui_get_value("mode");
            state_mode = (ScanaStudio.gui_get_value("sampling") == SAMPLING_STATE);

            if (state_mode) {
                ScanaStudio.gui_add_info_label("State mode: each sample is one REF_CLK rising edge, no clock channel is needed.", page_number);
            }
            else {
                ScanaStudio.gui_add_new_tab("Clock", true);
                ScanaStudio.gui_add_ch_selector("ch_refclk", "REF_CLK (50 MHz)", "REF_CLK", 0, page_number);
                ScanaStudio.gui_end_tab();
            }

            if (mode != MODE_TX) {
                ScanaStudio.gui_add_new_tab("RX", false);
                ScanaStudio.gui_add_ch_selector("ch_crs_dv", "CRS_DV", "CRS_DV", 1, page_number);
                ScanaStudio.gui_add_ch_selector("ch_rxd0", "RXD0", "RXD0", 2, page_number);
                ScanaStudio.gui_add_ch_selector("ch_rxd1", "RXD1", "RXD1", 3, page_number);
                ScanaStudio.gui_end_tab();
            }

            if (mode != MODE_RX) {
                var first_tx = (mode == MODE_BOTH) ? 4 : 1;
                var last_ch = ScanaStudio.get_device_channels_count() - 1;
                ScanaStudio.gui_add_new_tab("TX", false);
                ScanaStudio.gui_add_ch_selector("ch_tx_en", "TX_EN", "TX_EN", Math.min(first_tx, last_ch), page_number);
                ScanaStudio.gui_add_ch_selector("ch_txd0", "TXD0", "TXD0", Math.min(first_tx + 1, last_ch), page_number);
                ScanaStudio.gui_add_ch_selector("ch_txd1", "TXD1", "TXD1", Math.min(first_tx + 2, last_ch), page_number);
                ScanaStudio.gui_end_tab();
            }
            break;

        default:
            break;
    }
}

function on_eval_gui_decoder(page_number) {
    mode = ScanaStudio.gui_get_value("mode");
    state_mode = (ScanaStudio.gui_get_value("sampling") == SAMPLING_STATE);
    var required_channels = ((mode == MODE_BOTH) ? 6 : 3) + (state_mode ? 0 : 1);
    if (ScanaStudio.get_device_channels_count() < required_channels) {
        return "This configuration requires at least " + required_channels + " channels. " +
            "Your device only has " + ScanaStudio.get_device_channels_count() + " channels.";
    }

    if (page_number != 1) {
        return "";
    }

    var channel_usage = {};
    function check_channel(id, description) {
        var ch = ScanaStudio.gui_get_value(id);
        if (ch === undefined || ch < 0) {
            return null;
        }
        if (channel_usage[ch] !== undefined) {
            return "Channel " + (ch + 1) + " is assigned to both '" + channel_usage[ch] + "' and '" +
                description + "'. Each channel can only be used once.";
        }
        channel_usage[ch] = description;
        return null;
    }

    var list = state_mode ? [] : [["ch_refclk", "REF_CLK"]];
    if (mode != MODE_TX) {
        list.push(["ch_crs_dv", "CRS_DV"], ["ch_rxd0", "RXD0"], ["ch_rxd1", "RXD1"]);
    }
    if (mode != MODE_RX) {
        list.push(["ch_tx_en", "TX_EN"], ["ch_txd0", "TXD0"], ["ch_txd1", "TXD1"]);
    }
    for (var i = 0; i < list.length; i++) {
        var err = check_channel(list[i][0], list[i][1]);
        if (err) {
            return err;
        }
    }

    var name = "RMII";
    if (mode != MODE_TX) {
        name += " RX on CH" + (ScanaStudio.gui_get_value("ch_rxd0") + 1);
    }
    if (mode != MODE_RX) {
        name += " TX on CH" + (ScanaStudio.gui_get_value("ch_txd0") + 1);
    }
    ScanaStudio.set_script_instance_name(name);
    return "";
}

// -----------------------------------------------------------------------------
// Decoder globals and helpers
// -----------------------------------------------------------------------------

var mode;
var speed;
var state_mode;
var show_preamble;
var payload_display;
var hex_view;
var ch_refclk;
var sampling_rate;

var directions;       // array of direction state objects (RX and/or TX)
var dibit_clocks;     // REF_CLK cycles per dibit (1 or 10)
var clk_period;       // REF_CLK period in samples (measured, 1 in state mode)
var gap_threshold;    // EN low time (samples) that ends a frame
var stats_reported;   // frame total at the last console report

function reload_dec_gui_values() {
    mode = ScanaStudio.gui_get_value("mode");
    speed = ScanaStudio.gui_get_value("speed");
    show_preamble = ScanaStudio.gui_get_value("show_preamble");
    payload_display = ScanaStudio.gui_get_value("payload_display");
    hex_view = ScanaStudio.gui_get_value("hex_view");
    state_mode = (ScanaStudio.gui_get_value("sampling") == SAMPLING_STATE);
    ch_refclk = state_mode ? -1 : ScanaStudio.gui_get_value("ch_refclk");
    dibit_clocks = (speed == SPEED_10M) ? 10 : 1;
}

function new_direction(name, ch_en, ch_d0, ch_d1) {
    return {
        name: name,
        ch_en: ch_en,
        ch_d0: ch_d0,
        ch_d1: ch_d1,
        // frame boundary state machine on the enable line
        state: 0,         // 0: idle, 1: EN high, 2: EN low (maybe toggling)
        frame_start: -1,
        frame_end: -1,
        queue: [],        // complete frames {start, end} waiting to be decoded
        // statistics
        frame_count: 0,
        fcs_ok: 0,
        fcs_bad: 0,
        errors: 0
    };
}

function build_directions() {
    var list = [];
    if (mode != MODE_TX) {
        list.push(new_direction("RX",
            ScanaStudio.gui_get_value("ch_crs_dv"),
            ScanaStudio.gui_get_value("ch_rxd0"),
            ScanaStudio.gui_get_value("ch_rxd1")));
    }
    if (mode != MODE_RX) {
        list.push(new_direction("TX",
            ScanaStudio.gui_get_value("ch_tx_en"),
            ScanaStudio.gui_get_value("ch_txd0"),
            ScanaStudio.gui_get_value("ch_txd1")));
    }
    return list;
}

/**
 * Measures the REF_CLK period (in samples) from the first rising edges.
 * Returns -1 if not enough clock edges are available yet.
 */
function measure_clock_period() {
    ScanaStudio.trs_reset(ch_refclk);
    var last_rise = -1;
    var min_period = -1;
    var n = 0;
    while (ScanaStudio.trs_is_not_last(ch_refclk) && (n < 64)) {
        var t = ScanaStudio.trs_get_next(ch_refclk);
        if (t.value != 1) {
            continue;
        }
        if (last_rise >= 0) {
            var p = t.sample_index - last_rise;
            if ((min_period < 0) || (p < min_period)) {
                min_period = p;
            }
            n++;
        }
        last_rise = t.sample_index;
    }
    if (n < 4) {
        return -1;
    }
    return min_period;
}

// -----------------------------------------------------------------------------
// Decoder
// -----------------------------------------------------------------------------

function on_decode_signals(resume) {
    if (!check_api_version()) {
        ScanaStudio.console_error_msg("You need to update ScanaStudio to continue using this script.");
        return;
    }

    if (!resume) {
        reload_dec_gui_values();
        sampling_rate = ScanaStudio.get_capture_sample_rate();
        directions = build_directions();
        clk_period = -1;
        stats_reported = -1;
        for (var i = 0; i < directions.length; i++) {
            ScanaStudio.trs_reset(directions[i].ch_en);
        }
    }

    if ((clk_period < 0) && state_mode) {
        clk_period = 1;
        gap_threshold = 3 * dibit_clocks;
    }
    if (clk_period < 0) {
        clk_period = measure_clock_period();
        if (clk_period < 0) {
            return; // wait for more data
        }
        if (clk_period < 2) {
            ScanaStudio.console_warning_msg("REF_CLK is undersampled (" + clk_period +
                " samples per period). Increase the sampling rate to at least 4x REF_CLK.");
        }
        gap_threshold = 3 * dibit_clocks * clk_period;
    }

    for (var d = 0; d < directions.length; d++) {
        find_frames(directions[d]);
    }

    // Emit queued frames in chronological order across both directions, but never
    // past a frame that is still open on another direction.
    while (ScanaStudio.abort_is_requested() == false) {
        var best = null;
        var limit = Infinity;
        for (d = 0; d < directions.length; d++) {
            var dir = directions[d];
            if (dir.state != 0) {
                limit = Math.min(limit, dir.frame_start);
            }
            if ((dir.queue.length > 0) && ((best == null) || (dir.queue[0].start < best.queue[0].start))) {
                best = dir;
            }
        }
        if ((best == null) || (best.queue[0].start > limit)) {
            break;
        }
        var frame = best.queue.shift();
        decode_frame(best, frame.start, frame.end);
        ScanaStudio.report_progress(100 * frame.end / Math.max(1, ScanaStudio.get_available_samples(best.ch_en)));
    }

    report_statistics();
}

/**
 * Walks the enable line (CRS_DV or TX_EN) and queues every complete frame.
 * A frame ends when the enable line stays low longer than gap_threshold, which
 * absorbs the CRS_DV toggling at the end of RX frames.
 */
function find_frames(dir) {
    while (ScanaStudio.abort_is_requested() == false) {
        if (!ScanaStudio.trs_is_not_last(dir.ch_en)) {
            // No more transitions: an EN-low period long enough closes the frame
            if ((dir.state == 2) &&
                (ScanaStudio.get_available_samples(dir.ch_en) - dir.frame_end > gap_threshold)) {
                dir.queue.push({ start: dir.frame_start, end: dir.frame_end });
                dir.state = 0;
            }
            return;
        }
        var t = ScanaStudio.trs_get_next(dir.ch_en);
        switch (dir.state) {
            case 0:
                // sample 0 holds the initial level: a frame already running is skipped
                if ((t.value == 1) && (t.sample_index > 0)) {
                    dir.frame_start = t.sample_index;
                    dir.state = 1;
                }
                break;
            case 1:
                if (t.value == 0) {
                    dir.frame_end = t.sample_index;
                    dir.state = 2;
                }
                break;
            case 2:
                if (t.value == 1) {
                    if (t.sample_index - dir.frame_end > gap_threshold) {
                        dir.queue.push({ start: dir.frame_start, end: dir.frame_end });
                        dir.frame_start = t.sample_index;
                    }
                    dir.state = 1;
                }
                break;
        }
    }
}

/**
 * Samples D0/D1 on every REF_CLK rising edge in ]start, end[ and returns the
 * dibits as {v: [], s: []} (value 0..3 with D0 as LSB, and sample index).
 * At 10 Mbps, the stream is decimated to one sample in the middle of each dibit.
 */
function sample_dibits(dir, start, end) {
    var raw_v = [];
    var raw_s = [];
    if (state_mode) {
        sample_dibits_state(dir, start, end, raw_v, raw_s);
    }
    else {
        sample_dibits_timing(dir, start, end, raw_v, raw_s);
    }

    // Skip the leading 00 dibits (RX: CRS_DV asserted before the preamble)
    var first = 0;
    while ((first < raw_v.length) && (raw_v[first] == 0)) {
        first++;
    }
    if (dibit_clocks == 1) {
        return { v: raw_v.slice(first), s: raw_s.slice(first) };
    }
    var out = { v: [], s: [] };
    for (var i = first + Math.floor(dibit_clocks / 2); i < raw_v.length; i += dibit_clocks) {
        out.v.push(raw_v[i]);
        out.s.push(raw_s[i]);
    }
    return out;
}

/** Timing mode: D0/D1 sampled on each REF_CLK rising edge in ]start, end[. */
function sample_dibits_timing(dir, start, end, raw_v, raw_s) {
    var pos = start; // sync_decode skips an edge exactly at pos: the edge where EN rises still carries idle data
    while (ScanaStudio.abort_is_requested() == false) {
        var r = ScanaStudio.sync_decode(ch_refclk, [dir.ch_d0, dir.ch_d1], pos, 1, false, 32, true, 0, end);
        if (r.valid_bits == 0) {
            break;
        }
        var w = r.unsigned_words[0];
        var n = r.sampling_points.length;
        for (var k = 0; k < n; k++) {
            raw_v.push((w >>> (2 * k)) & 0x3);
            raw_s.push(r.sampling_points[k] + pos);
        }
        pos = r.end_sample + 1;
        if (r.valid_bits < 32) {
            break;
        }
    }
}

/**
 * State mode: every sample is a REF_CLK rising edge, and the enable line is
 * latched together with the data, so the samples [start, end[ are the frame.
 */
function sample_dibits_state(dir, start, end, raw_v, raw_s) {
    var d0 = channel_levels(dir.ch_d0, start, end);
    var d1 = channel_levels(dir.ch_d1, start, end);
    for (var s = start; s < end; s++) {
        raw_v.push(d0[s - start] | (d1[s - start] << 1));
        raw_s.push(s);
    }
}

/** Logic level of a channel on every sample of [start, end[. */
function channel_levels(ch, start, end) {
    var out = [];
    var t = ScanaStudio.trs_get_before(ch, start + 1); // transition in effect at start
    var level = t.value;
    var s = start;
    while ((s < end) && ScanaStudio.trs_is_not_last(ch)) {
        var next = ScanaStudio.trs_get_next(ch);
        if (next.sample_index <= t.sample_index) {
            continue;
        }
        var stop = Math.min(end, next.sample_index);
        for (; s < stop; s++) {
            out.push(level);
        }
        level = next.value;
        t = next;
    }
    for (; s < end; s++) {
        out.push(level);
    }
    return out;
}

function decode_frame(dir, start, end) {
    var dibits = sample_dibits(dir, start, end);
    var n = dibits.v.length;
    var ch = dir.ch_d0;

    dir.frame_count++;
    var frame_name = dir.name + " #" + dir.frame_count;

    function dibit_start(i) {
        return Math.max(start, dibit_first_sample(dibits.s[i]));
    }
    function dibit_end(i) {
        return dibit_last_sample(dibits.s[i]);
    }

    if (n == 0) {
        dir.errors++;
        add_error_item(ch, start, end, frame_name, "Empty frame (no data while enable is asserted)", "Empty frame");
        return;
    }

    // ---- Preamble / SFD ----
    var i = 0;
    var false_carrier = false;
    while ((i < n) && (dibits.v[i] != DIBIT_SFD_END)) {
        if (dibits.v[i] != DIBIT_PREAMBLE) {
            false_carrier = true;
        }
        i++;
    }
    if ((i >= n) || false_carrier) {
        dir.errors++;
        var why = (i >= n) ? "SFD not found" : "False carrier / invalid preamble";
        add_error_item(ch, dibit_start(0), dibit_end(n - 1), frame_name, why, why);
        return;
    }
    var sfd_last = i;
    var sfd_first = Math.max(0, sfd_last - 3);
    var preamble_dibits = sfd_first;

    ScanaStudio.packet_view_add_packet(true, ch, dibit_start(0), dibit_end(n - 1), frame_name, "",
        ScanaStudio.PacketColors.Wrap.Title, ScanaStudio.PacketColors.Wrap.Content);

    if (show_preamble && (preamble_dibits > 0)) {
        var pre_txt = (preamble_dibits / 4).toString();
        if (preamble_dibits % 4) {
            pre_txt = preamble_dibits + " dibits";
        }
        else {
            pre_txt += " bytes";
        }
        add_item(ch, dibit_start(0), dibit_end(preamble_dibits - 1),
            ["Preamble (" + pre_txt + ")", "Preamble", "P"], null, null);
        ScanaStudio.packet_view_add_packet(false, ch, dibit_start(0), dibit_end(preamble_dibits - 1),
            "Preamble", pre_txt, ScanaStudio.PacketColors.Preamble.Title, ScanaStudio.PacketColors.Preamble.Content);
    }
    add_item(ch, dibit_start(sfd_first), dibit_end(sfd_last),
        ["SFD 0xD5 - " + frame_name, "SFD " + frame_name, "SFD", "S"], dibit_points(dibits, sfd_first, sfd_last), null);
    ScanaStudio.packet_view_add_packet(false, ch, dibit_start(sfd_first), dibit_end(sfd_last),
        "SFD", "0xD5", ScanaStudio.PacketColors.Preamble.Title, ScanaStudio.PacketColors.Preamble.Content);

    // ---- Assemble bytes ----
    var bytes = [];
    var b_start = [];
    var b_end = [];
    var first_data = sfd_last + 1;
    var n_data = n - first_data;
    var n_bytes = Math.floor(n_data / 4);
    for (var b = 0; b < n_bytes; b++) {
        var k = first_data + 4 * b;
        bytes.push(dibits.v[k] | (dibits.v[k + 1] << 2) | (dibits.v[k + 2] << 4) | (dibits.v[k + 3] << 6));
        b_start.push(dibit_start(k));
        b_end.push(dibit_end(k + 3));
    }
    var dribble = n_data % 4;

    if (hex_view) {
        for (b = 0; b < n_bytes; b++) {
            ScanaStudio.hex_view_add_byte(ch, b_start[b], b_end[b], bytes[b]);
        }
    }

    if (n_bytes < ETH_HEADER_LEN + ETH_FCS_LEN) {
        dir.errors++;
        if (n_bytes > 0) {
            // the frame's root packet is already open: the error is one of its fields
            add_error_item(ch, b_start[0], b_end[n_bytes - 1], null,
                "Truncated frame (" + n_bytes + " bytes)", "Truncated");
        }
        add_dribble(dir, dibits, first_data + 4 * n_bytes, dribble);
        return;
    }

    // ---- Header ----
    var da = bytes.slice(0, 6);
    var sa = bytes.slice(6, 12);
    var da_str = fmt_mac(da);
    var sa_str = fmt_mac(sa);
    var da_kind = (da_str == "FF:FF:FF:FF:FF:FF") ? " (broadcast)" : ((da[0] & 1) ? " (multicast)" : "");
    add_bytes_item(ch, dibits, first_data, 0, 6,
        ["Destination MAC: " + da_str + da_kind, "DA: " + da_str, da_str, "DA"], null);
    ScanaStudio.packet_view_add_packet(false, ch, b_start[0], b_end[5], "Destination", da_str + da_kind,
        ScanaStudio.PacketColors.Head.Title, ScanaStudio.PacketColors.Head.Content);
    add_bytes_item(ch, dibits, first_data, 6, 12,
        ["Source MAC: " + sa_str, "SA: " + sa_str, sa_str, "SA"], null);
    ScanaStudio.packet_view_add_packet(false, ch, b_start[6], b_end[11], "Source", sa_str,
        ScanaStudio.PacketColors.Head.Title, ScanaStudio.PacketColors.Head.Content);

    var pos = 12;
    var type = (bytes[pos] << 8) | bytes[pos + 1];
    var vlan_txt = "";
    if ((type == 0x8100) || (type == 0x88A8)) {
        if (n_bytes >= ETH_HEADER_LEN + 4 + ETH_FCS_LEN) {
            var tci = (bytes[pos + 2] << 8) | bytes[pos + 3];
            vlan_txt = "VID " + (tci & 0x0FFF) + " PCP " + (tci >> 13) + ((tci & 0x1000) ? " DEI" : "");
            add_bytes_item(ch, dibits, first_data, pos, pos + 4,
                ["802.1Q tag: TPID " + hex(type, 4) + ", " + vlan_txt, "VLAN " + vlan_txt, "VID " + (tci & 0x0FFF), "Q"], null);
            ScanaStudio.packet_view_add_packet(false, ch, b_start[pos], b_end[pos + 3], "802.1Q", vlan_txt,
                ScanaStudio.PacketColors.Head.Title, ScanaStudio.PacketColors.Head.Content);
            pos += 4;
            type = (bytes[pos] << 8) | bytes[pos + 1];
        }
    }
    var type_txt;
    if (type <= 1500) {
        type_txt = "Length " + type;
    }
    else {
        type_txt = hex(type, 4) + " " + ethertype_name(type);
    }
    add_bytes_item(ch, dibits, first_data, pos, pos + 2,
        [((type <= 1500) ? "Length: " + type : "EtherType: " + type_txt), type_txt, hex(type, 4), "T"], null);
    ScanaStudio.packet_view_add_packet(false, ch, b_start[pos], b_end[pos + 1],
        (type <= 1500) ? "Length" : "EtherType", type_txt,
        ScanaStudio.PacketColors.Head.Title, ScanaStudio.PacketColors.Head.Content);
    pos += 2;

    // ---- Payload ----
    var fcs_pos = n_bytes - ETH_FCS_LEN;
    var payload = bytes.slice(pos, fcs_pos);
    var summary = payload_summary(type, payload);
    if (payload.length > 0) {
        if (payload_display == PAYLOAD_BYTES) {
            for (b = pos; b < fcs_pos; b++) {
                add_bytes_item(ch, dibits, first_data, b, b + 1,
                    [hex(bytes[b], 2) + " '" + printable(bytes[b]) + "'", hex(bytes[b], 2), bytes[b].toString(16).toUpperCase()], null);
            }
        }
        else {
            add_bytes_item(ch, dibits, first_data, pos, fcs_pos,
                ["Payload (" + payload.length + " bytes)" + (summary ? ": " + summary : ""), "Payload " + payload.length + " B", "Data"], null);
        }
        ScanaStudio.packet_view_add_packet(false, ch, b_start[pos], b_end[fcs_pos - 1],
            "Payload", payload.length + " bytes" + (summary ? ": " + summary : "") + " | " + hex_dump(payload, 16),
            ScanaStudio.PacketColors.Data.Title, ScanaStudio.PacketColors.Data.Content);
    }

    // ---- FCS ----
    var fcs_rx = (bytes[fcs_pos] | (bytes[fcs_pos + 1] << 8) | (bytes[fcs_pos + 2] << 16) | (bytes[fcs_pos + 3] << 24)) >>> 0;
    var fcs_calc = crc32(bytes, 0, fcs_pos);
    var fcs_good = (fcs_rx == fcs_calc);
    if (fcs_good) {
        dir.fcs_ok++;
        add_bytes_item(ch, dibits, first_data, fcs_pos, n_bytes,
            ["FCS: " + hex(fcs_rx, 8) + " OK", "FCS OK", "OK"], "success");
        ScanaStudio.packet_view_add_packet(false, ch, b_start[fcs_pos], b_end[n_bytes - 1], "FCS", hex(fcs_rx, 8) + " OK",
            ScanaStudio.PacketColors.Check.Title, ScanaStudio.PacketColors.Check.Content);
    }
    else {
        dir.fcs_bad++;
        add_bytes_item(ch, dibits, first_data, fcs_pos, n_bytes,
            ["FCS: " + hex(fcs_rx, 8) + " BAD (expected " + hex(fcs_calc, 8) + ")", "FCS BAD", "!"], "error");
        ScanaStudio.packet_view_add_packet(false, ch, b_start[fcs_pos], b_end[n_bytes - 1], "FCS",
            hex(fcs_rx, 8) + " BAD, expected " + hex(fcs_calc, 8),
            ScanaStudio.PacketColors.Error.Title, ScanaStudio.PacketColors.Error.Content);
    }

    // ---- Frame-level checks ----
    var notes = [];
    if (n_bytes < ETH_MIN_FRAME) {
        notes.push("runt (" + n_bytes + " < 64 bytes)");
    }
    if (n_bytes > ETH_MAX_FRAME) {
        notes.push("oversize (" + n_bytes + " > 1522 bytes)");
    }
    if (notes.length > 0) {
        dir.errors++;
        ScanaStudio.packet_view_add_packet(false, ch, b_start[0], b_end[n_bytes - 1], "Warning", notes.join(", "),
            ScanaStudio.PacketColors.Error.Title, ScanaStudio.PacketColors.Error.Content);
    }
    if (dribble) {
        add_dribble(dir, dibits, first_data + 4 * n_bytes, dribble);
    }

    // Frame summary, shown on the root packet's line in the packet view
    ScanaStudio.packet_view_add_packet(false, ch, b_start[0], b_end[n_bytes - 1], "Summary",
        sa_str + " > " + da_str + ", " + type_txt + (vlan_txt ? ", " + vlan_txt : "") + ", " + n_bytes +
        " bytes, FCS " + (fcs_good ? "OK" : "BAD"),
        fcs_good ? ScanaStudio.PacketColors.Misc.Title : ScanaStudio.PacketColors.Error.Title,
        fcs_good ? ScanaStudio.PacketColors.Misc.Content : ScanaStudio.PacketColors.Error.Content);
}

/** Trailing dibits that don't form a whole byte: alignment error. */
function add_dribble(dir, dibits, first, count) {
    if (count == 0) {
        return;
    }
    dir.errors++;
    var s = Math.max(0, dibit_first_sample(dibits.s[first]));
    var e = dibit_last_sample(dibits.s[first + count - 1]);
    add_error_item(dir.ch_d0, s, e, null, "Alignment error (" + count + " extra dibits)", "Align err");
}

/** First and last sample of the dibit sampled at s: one dibit period centred on s. */
function dibit_first_sample(s) {
    return s - Math.floor(dibit_clocks * clk_period / 2);
}

function dibit_last_sample(s) {
    return dibit_first_sample(s) + Math.max(1, Math.round(dibit_clocks * clk_period)) - 1;
}

function dibit_points(dibits, first, last) {
    var pts = [];
    for (var i = first; i <= last; i++) {
        pts.push(dibits.s[i]);
    }
    return pts;
}

/** Decoder item covering bytes [from, to[ of the frame data. */
function add_bytes_item(ch, dibits, first_data, from, to, contents, emphasis) {
    var k0 = first_data + 4 * from;
    var k1 = first_data + 4 * to - 1;
    var pts = (to - from <= 16) ? dibit_points(dibits, k0, k1) : null;
    add_item(ch, dibit_first_sample(dibits.s[k0]), dibit_last_sample(dibits.s[k1]), contents, pts, emphasis);
}

function add_item(ch, start, end, contents, points, emphasis) {
    if (ScanaStudio.dec_item_new(ch, start, end) != 1) {
        return;
    }
    for (var i = 0; i < contents.length; i++) {
        ScanaStudio.dec_item_add_content(contents[i]);
    }
    if (points) {
        for (i = 0; i < points.length; i++) {
            ScanaStudio.dec_item_add_sample_point(points[i], "P");
        }
    }
    if (emphasis == "error") {
        ScanaStudio.dec_item_emphasize_error();
    }
    else if (emphasis == "warning") {
        ScanaStudio.dec_item_emphasize_warning();
    }
    else if (emphasis == "success") {
        ScanaStudio.dec_item_emphasize_success();
    }
    ScanaStudio.dec_item_end();
}

function add_error_item(ch, start, end, frame_name, long_txt, short_txt) {
    add_item(ch, start, end, [(frame_name ? frame_name + ": " : "") + long_txt, short_txt, "!"], null, "error");
    ScanaStudio.packet_view_add_packet(frame_name != null, ch, start, end, frame_name ? frame_name : "Error", long_txt,
        ScanaStudio.PacketColors.Error.Title, ScanaStudio.PacketColors.Error.Content);
}

function report_statistics() {
    var total = 0;
    for (var d = 0; d < directions.length; d++) {
        total += directions[d].frame_count;
    }
    if (total == stats_reported) {
        return;
    }
    stats_reported = total;
    for (d = 0; d < directions.length; d++) {
        var dir = directions[d];
        ScanaStudio.console_info_msg("RMII " + dir.name + ": " + dir.frame_count + " frames, " +
            dir.fcs_ok + " FCS OK, " + dir.fcs_bad + " FCS errors, " + dir.errors + " other errors");
    }
}

// -----------------------------------------------------------------------------
// Ethernet helpers
// -----------------------------------------------------------------------------

var crc32_table = null;

/** IEEE 802.3 CRC32 (reflected, poly 0xEDB88320) over bytes [from, to[. */
function crc32(bytes, from, to) {
    if (crc32_table == null) {
        crc32_table = [];
        for (var n = 0; n < 256; n++) {
            var c = n;
            for (var k = 0; k < 8; k++) {
                c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            }
            crc32_table.push(c >>> 0);
        }
    }
    var crc = 0xFFFFFFFF;
    for (var i = from; i < to; i++) {
        crc = crc32_table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function hex(value, digits) {
    var s = (value >>> 0).toString(16).toUpperCase();
    while (s.length < digits) {
        s = "0" + s;
    }
    return "0x" + s;
}

function hex2(value) {
    var s = value.toString(16).toUpperCase();
    return (s.length < 2) ? "0" + s : s;
}

function hex_dump(bytes, max) {
    var parts = [];
    for (var i = 0; (i < bytes.length) && (i < max); i++) {
        parts.push(hex2(bytes[i]));
    }
    return parts.join(" ") + ((bytes.length > max) ? " ..." : "");
}

function printable(b) {
    return ((b >= 0x20) && (b < 0x7F)) ? String.fromCharCode(b) : ".";
}

function fmt_mac(b) {
    var parts = [];
    for (var i = 0; i < 6; i++) {
        parts.push(hex2(b[i]));
    }
    return parts.join(":");
}

function fmt_ip(b, at) {
    return b[at] + "." + b[at + 1] + "." + b[at + 2] + "." + b[at + 3];
}

function ethertype_name(type) {
    switch (type) {
        case 0x0800: return "IPv4";
        case 0x0806: return "ARP";
        case 0x86DD: return "IPv6";
        case 0x8100: return "VLAN";
        case 0x88A8: return "QinQ";
        case 0x8808: return "Pause";
        case 0x88CC: return "LLDP";
        case 0x88F7: return "PTP";
        case 0x8892: return "PROFINET";
        case 0x88A4: return "EtherCAT";
        case 0x8847: return "MPLS";
        default: return "";
    }
}

/** Short human readable summary of IPv4 / ARP payloads, or "" */
function payload_summary(type, p) {
    if ((type == 0x0806) && (p.length >= 28)) {
        var op = (p[6] << 8) | p[7];
        if (op == 1) {
            return "ARP who has " + fmt_ip(p, 24) + "? Tell " + fmt_ip(p, 14);
        }
        if (op == 2) {
            return "ARP " + fmt_ip(p, 14) + " is at " + fmt_mac(p.slice(8, 14));
        }
        return "ARP op " + op;
    }
    if ((type == 0x0800) && (p.length >= 20) && ((p[0] >> 4) == 4)) {
        var ihl = (p[0] & 0x0F) * 4;
        var proto = p[9];
        var txt = fmt_ip(p, 12) + " > " + fmt_ip(p, 16);
        if ((proto == 17) && (p.length >= ihl + 4)) {
            return "UDP " + txt + " ports " + ((p[ihl] << 8) | p[ihl + 1]) + " > " + ((p[ihl + 2] << 8) | p[ihl + 3]);
        }
        if ((proto == 6) && (p.length >= ihl + 4)) {
            return "TCP " + txt + " ports " + ((p[ihl] << 8) | p[ihl + 1]) + " > " + ((p[ihl + 2] << 8) | p[ihl + 3]);
        }
        if (proto == 1) {
            return "ICMP " + txt;
        }
        return "IPv4 proto " + proto + " " + txt;
    }
    return "";
}

/** Parses "AA:BB:CC:DD:EE:FF" (also '-' or no separator). Returns null if invalid. */
function parse_mac(text) {
    var clean = String(text).replace(/[\s:\-\.]/g, "");
    if (!/^[0-9a-fA-F]{12}$/.test(clean)) {
        return null;
    }
    var out = [];
    for (var i = 0; i < 6; i++) {
        out.push(parseInt(clean.substr(2 * i, 2), 16));
    }
    return out;
}

/** Parses a decimal or 0x-prefixed hexadecimal number. Returns NaN if invalid. */
function parse_number(text) {
    var s = String(text).trim();
    if (/^0x[0-9a-f]+$/i.test(s)) {
        return parseInt(s.substr(2), 16);
    }
    if (/^[0-9]+$/.test(s)) {
        return parseInt(s, 10);
    }
    return NaN;
}

// -----------------------------------------------------------------------------
// Trigger
// -----------------------------------------------------------------------------

function on_draw_gui_trigger() {
    ScanaStudio.gui_add_combo_box("trig_dir", "Direction (used when decoding RX and TX)");
    ScanaStudio.gui_add_item_to_combo_box("RX (CRS_DV, RXD)", true);
    ScanaStudio.gui_add_item_to_combo_box("TX (TX_EN, TXD)", false);

    ScanaStudio.gui_add_new_selectable_containers_group("trig_alt", "Select trigger type");
    ScanaStudio.gui_add_new_container("Any frame (SFD)", true);
    ScanaStudio.gui_add_info_label("Triggers at the end of the Start Frame Delimiter of any frame.\n" +
        "At 10 Mbps or in state mode, triggers on the rising edge of CRS_DV / TX_EN.");
    ScanaStudio.gui_end_container();
    ScanaStudio.gui_add_new_container("Destination MAC address (100 Mbps, timing mode)", false);
    ScanaStudio.gui_add_text_input("trig_mac", "Destination MAC", "FF:FF:FF:FF:FF:FF");
    ScanaStudio.gui_end_container();
    ScanaStudio.gui_add_new_container("EtherType (100 Mbps, timing mode)", false);
    ScanaStudio.gui_add_info_label("Untagged frames only. Type decimal (2048) or hex (0x0800).");
    ScanaStudio.gui_add_text_input("trig_type", "EtherType", "0x0800");
    ScanaStudio.gui_end_container();
    ScanaStudio.gui_end_selectable_containers_group();
}

function on_eval_gui_trigger() {
    var alt = Number(ScanaStudio.gui_get_value("trig_alt"));
    if ((alt != 0) && (ScanaStudio.gui_get_value("speed") == SPEED_10M)) {
        return "At 10 Mbps, only the 'Any frame' trigger is available.";
    }
    if ((alt != 0) && (ScanaStudio.gui_get_value("sampling") == SAMPLING_STATE)) {
        return "In state mode, only the 'Any frame' trigger is available.";
    }
    if ((alt == 1) && (parse_mac(ScanaStudio.gui_get_value("trig_mac")) == null)) {
        return "Please enter a valid MAC address (e.g. 01:23:45:67:89:AB).";
    }
    if (alt == 2) {
        var t = parse_number(ScanaStudio.gui_get_value("trig_type"));
        if (isNaN(t) || (t < 0) || (t > 0xFFFF)) {
            return "Please enter a valid 16-bit EtherType (e.g. 0x0800).";
        }
    }
    return "";
}

function on_build_trigger() {
    reload_dec_gui_values();
    var alt = Number(ScanaStudio.gui_get_value("trig_alt"));
    var use_tx = (mode == MODE_TX) || ((mode == MODE_BOTH) && (ScanaStudio.gui_get_value("trig_dir") == 1));
    var ch_en, ch_d0, ch_d1;
    if (use_tx) {
        ch_en = ScanaStudio.gui_get_value("ch_tx_en");
        ch_d0 = ScanaStudio.gui_get_value("ch_txd0");
        ch_d1 = ScanaStudio.gui_get_value("ch_txd1");
    }
    else {
        ch_en = ScanaStudio.gui_get_value("ch_crs_dv");
        ch_d0 = ScanaStudio.gui_get_value("ch_rxd0");
        ch_d1 = ScanaStudio.gui_get_value("ch_rxd1");
    }
    var n_ch = ScanaStudio.get_device_channels_count();

    // Rightmost character is channel 0
    function step(levels) {
        var s = "";
        for (var i = 0; i < n_ch; i++) {
            s = ((levels[i] !== undefined) ? levels[i] : "X") + s;
        }
        return s;
    }

    if ((speed == SPEED_10M) || state_mode) {
        var lv = {};
        lv[ch_en] = "R";
        ScanaStudio.flexitrig_append(step(lv), -1, -1);
        ScanaStudio.flexitrig_print_steps();
        return;
    }

    // One dibit = REF_CLK rising edge with D0/D1/EN levels, then a don't-care falling edge
    function append_dibit(v) {
        var lv = {};
        lv[ch_refclk] = "R";
        lv[ch_en] = "1";
        if (v >= 0) {
            lv[ch_d0] = (v & 1).toString();
            lv[ch_d1] = ((v >> 1) & 1).toString();
        }
        ScanaStudio.flexitrig_append(step(lv), -1, -1);
        lv = {};
        lv[ch_refclk] = "F";
        ScanaStudio.flexitrig_append(step(lv), -1, -1);
    }
    function append_byte(b) {
        for (var i = 0; i < 4; i++) {
            append_dibit((b < 0) ? -1 : ((b >> (2 * i)) & 0x3));
        }
    }

    append_byte(0xD5); // SFD: 01 01 01 11, unique against the preamble
    if (alt == 1) {
        var mac = parse_mac(ScanaStudio.gui_get_value("trig_mac"));
        for (var i = 0; i < 6; i++) {
            append_byte(mac[i]);
        }
    }
    else if (alt == 2) {
        var type = parse_number(ScanaStudio.gui_get_value("trig_type"));
        for (i = 0; i < 12; i++) {
            append_byte(-1);
        }
        append_byte((type >> 8) & 0xFF);
        append_byte(type & 0xFF);
    }
    ScanaStudio.flexitrig_print_steps();
}

// -----------------------------------------------------------------------------
// Demo signals builder
// -----------------------------------------------------------------------------

function on_build_demo_signals() {
    reload_dec_gui_values();
    var builder = ScanaStudio.BuilderObject;
    var sample_rate = ScanaStudio.builder_get_sample_rate();
    var half_period = Math.max(1, Math.floor(sample_rate / (2 * REF_CLK_FREQ)));
    var samples_per_clock = state_mode ? 1 : 2 * half_period;
    var samples_to_build = Math.min(ScanaStudio.builder_get_maximum_samples_count(),
        DEMO_MAX_CLOCKS * samples_per_clock);

    var rx = null;
    var tx = null;
    if (mode != MODE_TX) {
        rx = { en: ScanaStudio.gui_get_value("ch_crs_dv"), d0: ScanaStudio.gui_get_value("ch_rxd0"), d1: ScanaStudio.gui_get_value("ch_rxd1") };
    }
    if (mode != MODE_RX) {
        tx = { en: ScanaStudio.gui_get_value("ch_tx_en"), d0: ScanaStudio.gui_get_value("ch_txd0"), d1: ScanaStudio.gui_get_value("ch_txd1") };
    }
    builder.config(ch_refclk, rx, tx, speed, state_mode ? 0 : half_period);

    var host_mac = [0x02, 0x00, 0x5E, 0x10, 0x00, 0x01];
    var peer_mac = [0x00, 0x1B, 0x63, 0x84, 0x45, 0xE6];
    var host_ip = [192, 168, 1, 10];
    var peer_ip = [192, 168, 1, 1];
    var seq = 0;

    builder.put_idle(64);
    while (builder.samples_acc() < samples_to_build) {
        seq++;
        var rx_frames = [
            builder.arp_request(peer_mac, peer_ip, host_ip),
            builder.udp_frame(host_mac, peer_mac, peer_ip, host_ip, 5000, 6000, "RMII demo RX " + seq, 0),
            builder.udp_frame(host_mac, peer_mac, peer_ip, host_ip, 5000, 6000, "VLAN tagged frame " + seq, 100),
            builder.udp_frame(host_mac, peer_mac, peer_ip, host_ip, 5000, 6000, "Corrupted FCS " + seq, 0)
        ];
        var tx_frames = [
            builder.arp_reply(host_mac, host_ip, peer_mac, peer_ip),
            builder.udp_frame(peer_mac, host_mac, host_ip, peer_ip, 6000, 5000, "RMII demo TX " + seq, 0),
            builder.udp_frame([0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF], host_mac, host_ip, [192, 168, 1, 255], 6000, 6000, "Broadcast " + seq, 0),
            builder.udp_frame(peer_mac, host_mac, host_ip, peer_ip, 6000, 5000, "Ack " + seq, 0)
        ];
        for (var f = 0; f < rx_frames.length; f++) {
            // last RX frame of each burst has a wrong FCS; TX frames start a bit later to overlap (full duplex)
            builder.put_frames(rx_frames[f], (f == 3), tx_frames[f], false, 40);
            builder.put_idle(96);
            if (builder.samples_acc() >= samples_to_build) {
                break;
            }
        }
        builder.put_idle(400);
    }
    builder.finish();
}

ScanaStudio.BuilderObject = {
    config: function (ch_refclk, rx, tx, speed, half_period) {
        this.ch_clk = ch_refclk;
        this.lanes = [];
        if (rx) {
            this.lanes.push({ en: rx.en, d0: rx.d0, d1: rx.d1, is_rx: true });
        }
        if (tx) {
            this.lanes.push({ en: tx.en, d0: tx.d0, d1: tx.d1, is_rx: false });
        }
        this.dibit_clocks = (speed == SPEED_10M) ? 10 : 1;
        this.hp = half_period;
        // half_period == 0: state mode, one sample per REF_CLK cycle and no clock channel
        this.spc = (half_period > 0) ? 2 * half_period : 1;
        this.clk_cycles = 0;
        // Run length encoding per data channel: {level, clocks}
        this.runs = {};
        for (var i = 0; i < this.lanes.length; i++) {
            var l = this.lanes[i];
            this.runs[l.en] = { level: 0, clocks: 0 };
            this.runs[l.d0] = { level: 0, clocks: 0 };
            this.runs[l.d1] = { level: 0, clocks: 0 };
        }
        // Data changes on REF_CLK falling edges: offset data lanes by half a period
        if (this.hp > 0) {
            for (var ch in this.runs) {
                ScanaStudio.builder_add_samples(Number(ch), 0, this.hp);
            }
        }
    },

    samples_acc: function () {
        return ScanaStudio.builder_get_samples_acc(this.lanes[0].en);
    },

    level: function (ch, value) {
        var r = this.runs[ch];
        if (r.level != value) {
            if (r.clocks > 0) {
                ScanaStudio.builder_add_samples(ch, r.level, r.clocks * this.spc);
            }
            r.level = value;
            r.clocks = 0;
        }
        r.clocks++;
    },

    /** Advances all lanes by one REF_CLK cycle. states[i] = {v, en} or null (idle). */
    clock: function (states) {
        for (var i = 0; i < this.lanes.length; i++) {
            var l = this.lanes[i];
            var s = states[i];
            this.level(l.en, s ? s.en : 0);
            this.level(l.d0, s ? (s.v & 1) : 0);
            this.level(l.d1, s ? ((s.v >> 1) & 1) : 0);
        }
        this.clk_cycles++;
    },

    flush: function () {
        if ((this.clk_cycles > 0) && (this.hp > 0)) {
            ScanaStudio.builder_add_cycles(this.ch_clk, 0.5, this.spc, this.clk_cycles);
        }
        this.clk_cycles = 0;
        for (var ch in this.runs) {
            var r = this.runs[ch];
            if (r.clocks > 0) {
                ScanaStudio.builder_add_samples(Number(ch), r.level, r.clocks * this.spc);
                r.clocks = 0;
            }
        }
    },

    put_idle: function (dibits) {
        var n = dibits * this.dibit_clocks;
        for (var i = 0; i < n; i++) {
            this.clock([]);
        }
        this.flush();
    },

    /**
     * Converts a frame (DA..payload, without FCS) into the per-clock lane states:
     * preamble, SFD, data, FCS. RX frames get the CRS_DV toggling on the last 2 bytes.
     */
    lane_states: function (bytes, corrupt_fcs, is_rx) {
        var all = [0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0xD5].concat(bytes);
        var fcs = crc32(bytes, 0, bytes.length);
        if (corrupt_fcs) {
            fcs = (fcs ^ 0x00010000) >>> 0;
        }
        all.push(fcs & 0xFF, (fcs >>> 8) & 0xFF, (fcs >>> 16) & 0xFF, (fcs >>> 24) & 0xFF);
        var n_dibits = all.length * 4;
        var toggle_from = n_dibits - 8;
        var out = [];
        for (var k = 0; k < n_dibits; k++) {
            var v = (all[k >> 2] >> (2 * (k & 3))) & 0x3;
            // RX: carrier lost before the end of data, CRS_DV toggles low on the first dibit of each nibble
            var en = (is_rx && (k >= toggle_from) && ((k & 1) == 0)) ? 0 : 1;
            for (var c = 0; c < this.dibit_clocks; c++) {
                out.push({ v: v, en: en });
            }
        }
        return out;
    },

    /** Sends an RX and a TX frame at the same time, the TX one delayed by tx_delay dibits. */
    put_frames: function (rx_bytes, rx_corrupt, tx_bytes, tx_corrupt, tx_delay) {
        var seqs = [];
        var offsets = [];
        for (var i = 0; i < this.lanes.length; i++) {
            if (this.lanes[i].is_rx) {
                seqs.push(this.lane_states(rx_bytes, rx_corrupt, true));
                offsets.push(0);
            }
            else {
                seqs.push(this.lane_states(tx_bytes, tx_corrupt, false));
                offsets.push((this.lanes.length > 1) ? tx_delay * this.dibit_clocks : 0);
            }
        }
        var total = 0;
        for (i = 0; i < seqs.length; i++) {
            total = Math.max(total, seqs[i].length + offsets[i]);
        }
        for (var t = 0; t < total; t++) {
            var states = [];
            for (i = 0; i < seqs.length; i++) {
                var k = t - offsets[i];
                states.push(((k >= 0) && (k < seqs[i].length)) ? seqs[i][k] : null);
            }
            this.clock(states);
        }
        this.flush();
    },

    finish: function () {
        this.flush();
        // the clock lane is half a period behind the data lanes
        if (this.hp > 0) {
            ScanaStudio.builder_add_samples(this.ch_clk, 0, this.hp);
        }
    },

    // ---- frame factories (DA..payload, without FCS, padded to 60 bytes) ----

    eth_frame: function (da, sa, type, payload, vlan_id) {
        var f = da.concat(sa);
        if (vlan_id) {
            f.push(0x81, 0x00, (vlan_id >> 8) & 0x0F, vlan_id & 0xFF);
        }
        f.push((type >> 8) & 0xFF, type & 0xFF);
        f = f.concat(payload);
        while (f.length < 60 + (vlan_id ? 4 : 0)) {
            f.push(0);
        }
        return f;
    },

    arp_request: function (sa, sip, tip) {
        var p = [0x00, 0x01, 0x08, 0x00, 6, 4, 0x00, 0x01].concat(sa, sip, [0, 0, 0, 0, 0, 0], tip);
        return this.eth_frame([0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF], sa, 0x0806, p, 0);
    },

    arp_reply: function (sa, sip, da, dip) {
        var p = [0x00, 0x01, 0x08, 0x00, 6, 4, 0x00, 0x02].concat(sa, sip, da, dip);
        return this.eth_frame(da, sa, 0x0806, p, 0);
    },

    udp_frame: function (da, sa, sip, dip, sport, dport, text, vlan_id) {
        var data = [];
        for (var i = 0; i < text.length; i++) {
            data.push(text.charCodeAt(i) & 0xFF);
        }
        var udp_len = 8 + data.length;
        var ip_len = 20 + udp_len;
        var ip = [0x45, 0x00, ip_len >> 8, ip_len & 0xFF, 0x12, 0x34, 0x40, 0x00, 64, 17, 0, 0].concat(sip, dip);
        var sum = 0;
        for (i = 0; i < 20; i += 2) {
            sum += (ip[i] << 8) | ip[i + 1];
        }
        while (sum > 0xFFFF) {
            sum = (sum & 0xFFFF) + (sum >> 16);
        }
        sum = ~sum & 0xFFFF;
        ip[10] = sum >> 8;
        ip[11] = sum & 0xFF;
        var udp = [sport >> 8, sport & 0xFF, dport >> 8, dport & 0xFF, udp_len >> 8, udp_len & 0xFF, 0, 0];
        return this.eth_frame(da, sa, 0x0800, ip.concat(udp, data), vlan_id);
    }
};

// -----------------------------------------------------------------------------
// API version check
// -----------------------------------------------------------------------------

function version_str_to_int(str) {
    var v = str.split(".");
    if (v.length < 3) {
        return 0;
    }
    else {
        return (v[0] * 10000) + (v[1] * 100) + v[2];
    }
}

function check_api_version() {
    var required_str = "3.1.0";
    if (version_str_to_int(required_str) > version_str_to_int(
        ScanaStudio.get_api_version())) {
        return false; //API too old, update needed
    }
    else {
        return true;
    }
}
