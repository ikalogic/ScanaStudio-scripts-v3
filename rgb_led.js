/* Protocol meta info:
<NAME> RGB LED </NAME>
<DESCRIPTION>
Adressable RGB LED chipsets (WS281x, SK68xx, APA104, Wurth WL-ICLED, ...)
</DESCRIPTION>
<VERSION> 0.10 </VERSION>
<AUTHOR_NAME>  Vladislav Kosinov </AUTHOR_NAME>
<AUTHOR_URL> v.kosinov@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright 2019 Ikalogic SAS </COPYRIGHT>
<LICENSE> This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
v0.10: Clocked end frame is now DATA-high (per WL-ICLED datasheet). Rewrote clocked framing (start frame = 32 consecutive zeros, short zero runs flushed into the word) which removes the start/LED and end/start packet overlaps and the data-high end-frame handling. Generator end frame holds data high.
v0.9: Decoder GUI is now a 3-step wizard. Step 3 lets the user enable "Plot LED current" and only shows the plot options when enabled.
v0.8: Two-step GUI wizard (interface choice on step 1 conditions step 2). Added per-bit sample-point dots (1/0) on decoded items. Fixed clocked decoding desync after the first frame (start frame = >=32 zeros terminated by the first '1').
v0.7: Added two-wire (clocked, APA102/SK9822/WL-ICLED dual) interface with global-brightness scaling. Added APA102/SK9822 presets and a two-wire pattern generator. Fixed single-wire packet nesting (parent opened at frame start) and reset handling (tolerance + broken-reset still yields a valid packet).
v0.6: Added Wurth WL-ICLED chipset. Added estimated current trace (VAC). Added configurable pattern generator (LED count, color list and preset test routines).
v0.5: Improved last bit handling.
v0.4: Fix users gui settings refresh. Add RGB display format choice
V0.3: Updated packet view color palette
V0.2: Added dec_item_end() for each dec_item_new().
V0.1: Initial release.
</RELEASE_NOTES>
*/

var CHIPSETS_TABLE =
{
    WS2811   : {chip_id: 0, rst_time: (50 * 1e-6),  bit_time: 0,             bit_var: 0,            t0h: (250 * 1e-9), t0l: (1.0 * 1e-6),  t1h: (600 * 1e-9),  t1l: (650 * 1e-9), t_var: (150 * 1e-9), clr_order: "GRB", str: "WS2811"},
    WS2812   : {chip_id: 1, rst_time: (50 * 1e-6),  bit_time: (1.25 * 1e-6), bit_var: (600 * 1e-9), t0h: (350 * 1e-9), t0l: (800 * 1e-9),  t1h: (700 * 1e-9),  t1l: (600 * 1e-9), t_var: (150 * 1e-9), clr_order: "GRB", str: "WS2812"},
    WS2812B  : {chip_id: 2, rst_time: (50 * 1e-6),  bit_time: (1.25 * 1e-6), bit_var: (600 * 1e-9), t0h: (400 * 1e-9), t0l: (850 * 1e-9),  t1h: (800 * 1e-9),  t1l: (450 * 1e-9), t_var: (150 * 1e-9), clr_order: "GRB", str: "WS2812B"},
    WS2812V4 : {chip_id: 3, rst_time: (280 * 1e-6), bit_time: 0,             bit_var: 0,            t0h: (300 * 1e-9), t0l: (790 * 1e-9),  t1h: (790 * 1e-9),  t1l: (320 * 1e-9), t_var: (210 * 1e-9), clr_order: "GRB", str: "WS2812-V4"},
    WS2813   : {chip_id: 4, rst_time: (300 * 1e-6), bit_time: (1.25 * 1e-6), bit_var: (300 * 1e-9), t0h: (375 * 1e-9), t0l: (300 * 1e-9),  t1h: (875 * 1e-9),  t1l: (300 * 1e-9), t_var: (150 * 1e-9), clr_order: "GRB", str: "WS2813"},
    WS2815   : {chip_id: 5, rst_time: (280 * 1e-6), bit_time: 0,             bit_var: 0,            t0h: (300 * 1e-9), t0l: (1.09 * 1e-6), t1h: (1.09 * 1e-6), t1l: (320 * 1e-9), t_var: (510 * 1e-9), clr_order: "GRB", str: "WS2815"},
    APA104   : {chip_id: 6, rst_time: (24 * 1e-6),  bit_time: (1.25 * 1e-6), bit_var: (600 * 1e-9), t0h: (350 * 1e-9), t0l: (1.36 * 1e-6), t1h: (1.36 * 1e-6), t1l: (350 * 1e-9), t_var: (150 * 1e-9), clr_order: "RGB", str: "APA104"},
    SK6805   : {chip_id: 7, rst_time: (24 * 1e-6),  bit_time: (1.25 * 1e-6), bit_var: (600 * 1e-9), t0h: (300 * 1e-9), t0l: (900 * 1e-9),  t1h: (900 * 1e-9),  t1l: (300 * 1e-9), t_var: (150 * 1e-9), clr_order: "RGB", str: "SK6805"},
    SK6812   : {chip_id: 8, rst_time: (80 * 1e-6),  bit_time: (1.25 * 1e-6), bit_var: (600 * 1e-9), t0h: (300 * 1e-9), t0l: (900 * 1e-9),  t1h: (600 * 1e-9),  t1l: (600 * 1e-9), t_var: (150 * 1e-9), clr_order: "GRB", str: "SK6812"},
    WLICLED  : {chip_id: 9, rst_time: (200 * 1e-6), bit_time: (1.2 * 1e-6),  bit_var: (300 * 1e-9), t0h: (300 * 1e-9), t0l: (900 * 1e-9),  t1h: (900 * 1e-9),  t1l: (300 * 1e-9), t_var: (150 * 1e-9), clr_order: "GRB", str: "WL-ICLED"},
    CUSTOM   : {chip_id: 10, rst_time: (80 * 1e-6), bit_time: (1.25 * 1e-6), bit_var: (600 * 1e-9), t0h: (300 * 1e-9), t0l: (900 * 1e-9),  t1h: (600 * 1e-9),  t1l: (600 * 1e-9), t_var: (150 * 1e-9), clr_order: "GRB", str: "CUSTOM"}
};

var CLR_ORDER_TABLE =
{
    RGB : {clr_id: 0, clr_str: "RGB"},
    GRB : {clr_id: 1, clr_str: "GRB"}
};

// Clocked (two-wire, APA102/SK9822-class) chipsets. "order" is the on-wire order
// of the 3 PWM bytes that follow the control byte. These devices are 32 bits/LED:
// a "111ggggg" control byte (5-bit global brightness) + 3 PWM bytes, MSB first,
// sampled on the rising clock edge, framed by a 32-zero start frame.
var CLOCKED_CHIPSETS_TABLE =
{
    WLICLED_1616 : {id: 0, order: "GBR", str: "WL-ICLED 1616 (dual)"},
    WLICLED_5050 : {id: 1, order: "BGR", str: "WL-ICLED 5050 (dual)"},
    APA102       : {id: 2, order: "BGR", str: "APA102 / DotStar"},
    SK9822       : {id: 3, order: "BGR", str: "SK9822"}
};

function clocked_chips_in_order ()
{
    var a = [];
    for (var i in CLOCKED_CHIPSETS_TABLE)
    {
        a.push(CLOCKED_CHIPSETS_TABLE[i]);
    }
    return a;
}

// Map the 3 on-wire PWM bytes (in transmission order) to {r,g,b} according to a
// 3-char order string (a permutation of R/G/B, e.g. "GBR", "BGR", "RGB", "GRB").
function map_color_bytes (order, b0, b1, b2)
{
    var bytes = [b0, b1, b2];
    var c = {r: 0, g: 0, b: 0};

    for (var i = 0; i < 3; i++)
    {
        if (order.charAt(i) == "R") c.r = bytes[i];
        else if (order.charAt(i) == "G") c.g = bytes[i];
        else c.b = bytes[i];
    }

    return c;
}

// Inverse of map_color_bytes: return the 3 PWM bytes in transmission order for a
// given color and order string. Used by the clocked signal builder.
function color_to_bytes (order, r, g, b)
{
    var out = [0, 0, 0];

    for (var i = 0; i < 3; i++)
    {
        if (order.charAt(i) == "R") out[i] = r & 0xFF;
        else if (order.charAt(i) == "G") out[i] = g & 0xFF;
        else out[i] = b & 0xFF;
    }

    return out;
}

function BitObject (st_sample, end_sample, value)
{
    this.st_sample = st_sample;
	this.end_sample = end_sample;
    this.value = value;
}

//Global variables
var ch = 0;
var ch_clk = 0;
var interface_mode = 0; // 0 = single-wire (NRZ), 1 = two-wire (clocked)
var clocked_chip = null;

// Clocked (two-wire) decoder state.
var clk_trs = null;
var clk_pending = [];         // samples of a pending zero run (start-frame detection)
var clk_zero_start_sample = 0;
var clk_word = [];            // accumulated {s,v} bits of the current 32-bit word
var clk_prev_sample = -1;     // previous rising-edge sample (for clock-period estimate)
var clk_period = 0;           // estimated samples per clock (for box widening)
var sample_rate = 0;
var state_machine = 0;
var disp_format;
var chip = null;
var trs = null, trs_last = null;
var bit_time = 0;
var t0h = false, t1h = false;
var bitstream_arr = [];
var bit_object = null;
var bit_cnt = 0, word_cnt = 0;

// Current trace (VAC) state.
// current_trace_mode: 0 = off, 1 = plot per-LED current (one graph per LED).
var current_trace_mode = 0;
var i_max = 0.0145;          // max current per color channel [A] (WL-ICLED datasheet typ. max)
var max_led_graphs = 8;      // user-selected cap; -1 = "all" (auto, capped at VAC_HARD_CAP)
var VAC_HARD_CAP = 32;       // never create more than this many per-LED graphs
var vac_count = 0;           // per-LED VAC channels created so far

// True while a frame's parent packet ("RGB LED") is open and accepting LED /
// reset child packets. The parent is opened on the first LED of a frame so that
// children nest correctly (see decode_word / the frame-terminator handling).
var frame_open = false;

// Distinct color (#RRGGBB) for the per-LED current graph at a given index.
function led_graph_color (idx)
{
    var c = hsv_to_rgb((idx * 0.13) % 1, 0.85, 1);
    return "#" + c.r.toString(16).toUpperCase().pad() +
                 c.g.toString(16).toUpperCase().pad() +
                 c.b.toString(16).toUpperCase().pad();
}

// Lazily create the VAC for LED index 'idx' (one graph per LED). Returns false if
// plotting is off or the index is beyond the user's cap.
function ensure_led_vac (idx)
{
    if (current_trace_mode != 1) return false;

    var cap = (max_led_graphs <= 0) ? VAC_HARD_CAP : Math.min(max_led_graphs, VAC_HARD_CAP);
    if (idx >= cap) return false;

    while (vac_count <= idx)
    {
        ScanaStudio.vac_create_channel(vac_count, "A", led_graph_color(vac_count), "LED " + (vac_count + 1) + " current");
        ScanaStudio.vac_set_size(vac_count, 4);
        vac_count++;
    }
    return true;
}

// Plot one LED's estimated current on its own graph. The value is held by the VAC
// until this LED is updated again (next frame), giving a per-LED current envelope.
function plot_led_current (led_index, r, g, b, sample)
{
    if (!ensure_led_vac(led_index)) return;
    var amps = ((r + g + b) / 255) * i_max;
    ScanaStudio.vac_append_sample(led_index, sample, amps);
}

// Returns the chipsets as an array, in declaration order (used by the combo
// boxes and to resolve a combo box index back to a chipset object).
function chips_in_order ()
{
    var a = [];
    for (var i in CHIPSETS_TABLE)
    {
        a.push(CHIPSETS_TABLE[i]);
    }
    return a;
}

// Extend the String object with the zero padding method
String.prototype.pad = function(size)
{
    var s = String(this);
    while (s.length < (size || 2)) {s = "0" + s;}
    return s;
};

function get_current_chip()
{
    var user_chip_id = Number(ScanaStudio.gui_get_value("chip_id"));
    var c = null;

    for (var i in CHIPSETS_TABLE)
    {
        if (CHIPSETS_TABLE[i].chip_id == user_chip_id)
        {
            c = CHIPSETS_TABLE[i];
        }
    }

    return c;
}

function update_current_chip (updated_chip)
{
    var user_chip_id = Number(ScanaStudio.gui_get_value("chip_id"));

    for (var i in CHIPSETS_TABLE)
    {
        if (CHIPSETS_TABLE[i].chip_id == user_chip_id)
        {
            CHIPSETS_TABLE[i] = updated_chip;
        }
    }
}

//Decoder GUI - two-step wizard:
//  Page 0: interface (1-wire vs 2-wire) + display / current options.
//  Page 1: channel assignment + chipset, conditioned by the chosen interface.
function on_get_n_pages_gui_decoder()
{
    return 3;
}

function on_draw_gui_decoder(page_number)
{
    if (page_number == 0)
    {
        ScanaStudio.gui_add_info_label("Step 1: choose the LED interface and display options.", page_number);

        ScanaStudio.gui_add_combo_box("interface", "LED interface", page_number);
            ScanaStudio.gui_add_item_to_combo_box("Single-wire (NRZ, WS2812 / WL-ICLED single-wire)", true);
            ScanaStudio.gui_add_item_to_combo_box("Two-wire (clocked, APA102 / WL-ICLED dual)", false);

        ScanaStudio.gui_add_combo_box("disp_format", "RGB display format", page_number);
            ScanaStudio.gui_add_item_to_combo_box("Decimal", false);
            ScanaStudio.gui_add_item_to_combo_box("Hex", true);

        return;
    }

    if (page_number == 2)
    {
        // Step 3: optional LED current plot. The plot settings only appear when
        // the user enables it (selectable container, like states.js clock mode).
        ScanaStudio.gui_add_info_label("Step 3: optionally plot the estimated LED current.", page_number);

        ScanaStudio.gui_add_new_selectable_containers_group("plot_current", "Plot LED current", page_number);

        ScanaStudio.gui_add_new_container("Do not plot current", true, page_number);
        ScanaStudio.gui_end_container();

        ScanaStudio.gui_add_new_container("Plot LED current", false, page_number);
            ScanaStudio.gui_add_combo_box("max_led_graphs", "How many LED graphs to plot", page_number);
                ScanaStudio.gui_add_item_to_combo_box("First 4 LEDs", false);
                ScanaStudio.gui_add_item_to_combo_box("First 8 LEDs", true);
                ScanaStudio.gui_add_item_to_combo_box("First 16 LEDs", false);
                ScanaStudio.gui_add_item_to_combo_box("First 32 LEDs", false);
                ScanaStudio.gui_add_item_to_combo_box("All LEDs (auto, max 32)", false);
            ScanaStudio.gui_add_engineering_form_input_box("i_max", "Max current per color channel", (1 * 1e-3), (100 * 1e-3), 0.0145, "A", page_number);
            ScanaStudio.gui_add_info_label("One graph per LED, showing that LED's estimated current (I = (R+G+B)/255 x max current; clocked LEDs also scale by the global brightness). The value is held until the LED is updated in the next frame. It is an estimate, not a measurement. Single-wire WL-ICLED ~14.5mA/ch, dual-wire ~6.75mA/ch.", page_number);
        ScanaStudio.gui_end_container();

        ScanaStudio.gui_end_selectable_containers_group();

        return;
    }

    // page_number == 1 : channels + chipset, conditioned by the interface choice.
    var iface = Number(ScanaStudio.gui_get_value("interface"));

    if (iface == 1) // Two-wire (clocked)
    {
        ScanaStudio.gui_add_info_label("Step 2: two-wire (clocked) channels and chipset.", page_number);

        ScanaStudio.gui_add_ch_selector("ch", "Data line (DIN)", "DIN", 0, page_number);
        ScanaStudio.gui_add_ch_selector("ch_clk", "Clock line (CIN)", "CLK", 1, page_number);

        ScanaStudio.gui_add_combo_box("chip_clocked", "Clocked chipset", page_number);
        var clk_chips = clocked_chips_in_order();
        for (var k = 0; k < clk_chips.length; k++)
        {
            ScanaStudio.gui_add_item_to_combo_box(clk_chips[k].str, (k == 0));
        }

        return;
    }

    // Single-wire (NRZ)
    ScanaStudio.gui_add_info_label("Step 2: single-wire (NRZ) channel and chipset timing.", page_number);

    ScanaStudio.gui_add_ch_selector("ch", "Data line (DIN)", "DIN", 0, page_number);

    ScanaStudio.gui_add_new_selectable_containers_group("chip_id", "Chipset", page_number);

    for (var i in CHIPSETS_TABLE)
    {
        var c = CHIPSETS_TABLE[i];

        if (i == 0)
        {
            ScanaStudio.gui_add_new_container(c.str, true, page_number);
        }
        else
        {
            ScanaStudio.gui_add_new_container(c.str, false, page_number);
        }

        ScanaStudio.gui_add_engineering_form_input_box(c.str + "_rst_time", "Reset time", (c.rst_time / 10), (c.rst_time * 10), c.rst_time, "s", page_number);

        if (c.bit_time > 0)
        {
            ScanaStudio.gui_add_engineering_form_input_box(c.str + "_bit_time", "Bit time", (c.bit_time / 10), (c.bit_time * 10), c.bit_time, "s", page_number);

            if (c.bit_var > 0)
            {
                ScanaStudio.gui_add_engineering_form_input_box(c.str + "_bit_var", "Bit time variation (+/-)", (c.bit_var / 10), (c.bit_var * 10), c.bit_var, "s", page_number);
            }
        }

        ScanaStudio.gui_add_engineering_form_input_box(c.str + "_t0h", "T0H", (c.t0h / 10), (c.t0h * 10), c.t0h, "s", page_number);
        ScanaStudio.gui_add_engineering_form_input_box(c.str + "_t0l", "T0L", (c.t0l / 10), (c.t0l * 10), c.t0l, "s", page_number);
        ScanaStudio.gui_add_engineering_form_input_box(c.str + "_t1h", "T1H", (c.t1h / 10), (c.t1h * 10), c.t1h, "s", page_number);
        ScanaStudio.gui_add_engineering_form_input_box(c.str + "_t1l", "T1L", (c.t1l / 10), (c.t1l * 10), c.t1l, "s", page_number);

        if (c.t_var > 0)
        {
            ScanaStudio.gui_add_engineering_form_input_box(c.str + "_t_var", "TnX time variation (+/-)", (c.t_var / 10), (c.t_var * 10), c.t_var, "s", page_number);
        }

        ScanaStudio.gui_add_combo_box(c.str + "_clr_order", "Color order", page_number);

        if (c.clr_order == "RGB")
        {
            ScanaStudio.gui_add_item_to_combo_box("RGB", true);
            ScanaStudio.gui_add_item_to_combo_box("GRB", false);
        }
        else
        {
            ScanaStudio.gui_add_item_to_combo_box("RGB", false);
            ScanaStudio.gui_add_item_to_combo_box("GRB", true);
        }

        ScanaStudio.gui_end_container();
    }

    ScanaStudio.gui_end_selectable_containers_group();
}

// Read all decoder settings from the GUI and apply them. Called at decode time
// (and from the demo builder) when every page's items are committed. Only reads
// the items that exist for the selected interface, so it never references a
// missing GUI item.
function read_decoder_settings()
{
    disp_format = Number(ScanaStudio.gui_get_value("disp_format")) ? 16 : 10;
    interface_mode = Number(ScanaStudio.gui_get_value("interface"));

    // Step 3: "plot_current" container 0 = off, 1 = plot per-LED current.
    if (Number(ScanaStudio.gui_get_value("plot_current")) == 1)
    {
        current_trace_mode = 1;
        // max_led_graphs combo: 0->4, 1->8, 2->16, 3->32, 4->all(-1).
        var sel = Number(ScanaStudio.gui_get_value("max_led_graphs"));
        var caps = [4, 8, 16, 32, -1];
        max_led_graphs = (sel >= 0 && sel < caps.length) ? caps[sel] : 8;
        i_max = Number(ScanaStudio.gui_get_value("i_max"));
    }
    else
    {
        current_trace_mode = 0;
    }

    if (interface_mode == 1)
    {
        clocked_chip = clocked_chips_in_order()[Number(ScanaStudio.gui_get_value("chip_clocked"))];
        return;
    }

    var c = get_current_chip();

    c.rst_time = Number(ScanaStudio.gui_get_value(c.str + "_rst_time"));

    if (c.bit_time > 0)
    {
        c.bit_time = Number(ScanaStudio.gui_get_value(c.str + "_bit_time"));
    }

    if (c.bit_var > 0)
    {
        c.bit_var = Number(ScanaStudio.gui_get_value(c.str + "_bit_var"));
    }

    c.t0h = Number(ScanaStudio.gui_get_value(c.str + "_t0h"));
    c.t0l = Number(ScanaStudio.gui_get_value(c.str + "_t0l"));
    c.t1h = Number(ScanaStudio.gui_get_value(c.str + "_t1h"));
    c.t1l = Number(ScanaStudio.gui_get_value(c.str + "_t1l"));

    if (c.t_var > 0)
    {
        c.t_var = Number(ScanaStudio.gui_get_value(c.str + "_t_var"));
    }

    var clr_id = Number(ScanaStudio.gui_get_value(c.str + "_clr_order"));

    for (var i in CLR_ORDER_TABLE)
    {
        if (CLR_ORDER_TABLE[i].clr_id == clr_id)
        {
            c.clr_order = CLR_ORDER_TABLE[i].clr_str;
        }
    }

    update_current_chip(c);
}

//Evaluate decoder GUI. Multi-page: only touch items that exist on the page being
//evaluated, otherwise ScanaStudio reports "GUI item cannot be found".
function on_eval_gui_decoder(page_number)
{
    interface_mode = Number(ScanaStudio.gui_get_value("interface"));

    // The single-wire timing fields only exist on page 1 in single-wire mode.
    if (page_number == 1 && interface_mode == 0)
    {
        var c = get_current_chip();

        var t0h = Number(ScanaStudio.gui_get_value(c.str + "_t0h"));
        var t0l = Number(ScanaStudio.gui_get_value(c.str + "_t0l"));
        var t1h = Number(ScanaStudio.gui_get_value(c.str + "_t1h"));
        var t1l = Number(ScanaStudio.gui_get_value(c.str + "_t1l"));

        if (c.bit_time > 0)
        {
            var bit_time = Number(ScanaStudio.gui_get_value(c.str + "_bit_time"));
            var bit_var = (c.bit_var > 0) ? Number(ScanaStudio.gui_get_value(c.str + "_bit_var")) : 0;
            var bit_time_max = bit_time + bit_var;
            var bit_time_min = bit_time - bit_var;

            if ((t0h + t0l) > bit_time_max) return "'T0H' + 'T0L' cannot be superior than 'Bit time' + 'Bit time variation'";
            if ((t0h + t0l) < bit_time_min) return "'T0H' + 'T0L' cannot be inferior than 'Bit time' - 'Bit time variation'";
            if ((t1h + t1l) > bit_time_max) return "'T1H' + 'T1L' cannot be superior than 'Bit time' + 'Bit time variation'";
            if ((t1h + t1l) < bit_time_min) return "'T1H' + 'T1L' cannot be inferior than 'Bit time' - 'Bit time variation'";
        }
    }

    return "";
}

// Reset the per-LED current graphs. Channels are created lazily during decoding
// (one per LED, up to the user's cap), so here we just clear any stale ones.
function setup_current_vac ()
{
    for (var i = 0; i < VAC_HARD_CAP; i++)
    {
        ScanaStudio.vac_remove_channel(i);
    }
    vac_count = 0;
}

function on_decode_signals (resume)
{
    var bit_time_max, bit_time_min;

    read_decoder_settings();

    if (interface_mode == 1)
    {
        decode_signals_clocked(resume);
        return;
    }

    chip = get_current_chip();

    if (!resume)
    {
        state_machine = 0;
        sample_rate = ScanaStudio.get_capture_sample_rate();
        ch = Number(ScanaStudio.gui_get_value("ch"));
        bit_object = new BitObject(0, 0, 0);

        word_cnt = 0;
        frame_open = false;
        bitstream_arr = [];

        setup_current_vac();

        ScanaStudio.trs_reset(ch);
        trs = ScanaStudio.trs_get_next(ch);
    }

    do
    {
        if (ScanaStudio.abort_is_requested())
        {
            return;
        }

        if (chip.bit_time > 0)
        {
            bit_time_max = chip.bit_time;
            bit_time_min = chip.bit_time;
        }

        if (chip.bit_var > 0)
        {
            bit_time_max += chip.bit_var;
            bit_time_min -= chip.bit_var;
        }

        trs_last = trs;
        if(ScanaStudio.trs_is_not_last(ch))
            trs = ScanaStudio.trs_get_next(ch);
        else if(ScanaStudio.get_available_samples() - trs.sample_index > chip.rst_time * sample_rate)
        {
            trs = ScanaStudio.trs_get_next(ch);
        }
        else
        {
            return;
        }
        var t = (trs.sample_index - trs_last.sample_index) / sample_rate;

        if (trs_last.value > 0)
        {
            if ((t >= (chip.t0h - chip.t_var)) && (t <= (chip.t0h + chip.t_var)))
            {
                t0h = true;
                t1h = false;
                bit_object = new BitObject(trs_last.sample_index, 0, 0);
            }
            else if ((t >= (chip.t1h - chip.t_var)) && (t <= (chip.t1h + chip.t_var)))
            {
                t1h = true;
                t0h = false;
                bit_object = new BitObject(trs_last.sample_index, 0, 0);
            }
            else
            {
                t0h = false;
                t1h = false;

                ScanaStudio.dec_item_new(ch, trs_last.sample_index, trs.sample_index);
                ScanaStudio.dec_item_add_content("WRONG T1H/T0H DURATION");
                ScanaStudio.dec_item_add_content("WRONG");
                ScanaStudio.dec_item_add_content("!");
                ScanaStudio.dec_item_emphasize_error();
                ScanaStudio.dec_item_end();
            }
        }
        else
        {
            // A low longer than the longest valid bit-low is a frame terminator
            // (reset / latch), whether or not its duration is a clean reset.
            var max_bit_low = Math.max(chip.t0l, chip.t1l) + chip.t_var;

            if (t > max_bit_low)
            {
                // Finalize the bit that was pending (its low merged into this gap).
                if (t0h || t1h)
                {
                    if (t0h)
                    {
                        bit_object.value = 0;
                        bit_object.end_sample = (trs_last.sample_index + (chip.t0h * sample_rate));
                    }
                    else
                    {
                        bit_object.value = 1;
                        bit_object.end_sample = (trs_last.sample_index + (chip.t1h * sample_rate));
                    }

                    bit_cnt++;
                    decode_word(bit_object);

                    t0h = false;
                    t1h = false;
                }

                var rst_st = (trs_last.sample_index + (chip.t1h * sample_rate));
                // Allow a small rounding margin so a reset of exactly rst_time still
                // reads as valid; anything shorter is flagged but still terminates.
                var reset_ok = (t >= (chip.rst_time * 0.98));

                ScanaStudio.dec_item_new(ch, rst_st, trs.sample_index);
                if (reset_ok)
                {
                    ScanaStudio.dec_item_add_content("RESET");
                    ScanaStudio.dec_item_add_content("RST");
                    ScanaStudio.dec_item_add_content("R");
                }
                else
                {
                    ScanaStudio.dec_item_add_content("RESET (bad duration)");
                    ScanaStudio.dec_item_add_content("RST!");
                    ScanaStudio.dec_item_add_content("!");
                    ScanaStudio.dec_item_emphasize_error();
                }
                ScanaStudio.dec_item_end();

                // Close the frame's packet: the reset is a child of the current
                // parent. A broken reset still yields a valid parent + children,
                // with only the reset field flagged as error.
                if (frame_open)
                {
                    if (reset_ok)
                    {
                        ScanaStudio.packet_view_add_packet(false, ch, rst_st, trs.sample_index, "LED", "RESET",
                                                           ScanaStudio.PacketColors.Wrap.Title, ScanaStudio.PacketColors.Wrap.Content);
                    }
                    else
                    {
                        ScanaStudio.packet_view_add_packet(false, ch, rst_st, trs.sample_index, "RESET", "Bad duration",
                                                           ScanaStudio.PacketColors.Error.Title, ScanaStudio.PacketColors.Error.Content);
                    }
                    frame_open = false;
                }

                word_cnt = 0;
            }
            else if ((t >= (chip.t0l - chip.t_var)) && (t <= (chip.t0l + chip.t_var)))
            {
                if (t0h)
                {
                    bit_object.end_sample = trs.sample_index;
                    bit_object.value = 0;
                    t0h = false;
                    bit_cnt++;

                    if (chip.bit_time > 0)
                    {
                        if ((bit_object.end_sample - bit_object.st_sample) > (bit_time_max * sample_rate))
                        {
                            ScanaStudio.dec_item_new(ch, bit_object.st_sample, bit_object.end_sample);
                            ScanaStudio.dec_item_emphasize_warning();
                            ScanaStudio.dec_item_end();
                        }
                        else if ((bit_object.end_sample - bit_object.st_sample) < (bit_time_min * sample_rate))
                        {
                            ScanaStudio.dec_item_new(ch, bit_object.st_sample, bit_object.end_sample);
                            ScanaStudio.dec_item_emphasize_warning();
                            ScanaStudio.dec_item_end();
                        }
                    }

                    decode_word(bit_object);
                }
                else
                {
                    ScanaStudio.dec_item_new(ch, trs_last.sample_index, trs.sample_index);
                    ScanaStudio.dec_item_add_content("WRONG BIT STATE");
                    ScanaStudio.dec_item_add_content("WRONG");
                    ScanaStudio.dec_item_add_content("!");
                    ScanaStudio.dec_item_emphasize_error();
                    ScanaStudio.dec_item_end();
                }
            }
            else if ((t >= (chip.t1l - chip.t_var)) && (t <= (chip.t1l + chip.t_var)))
            {
                if (t1h)
                {
                    bit_object.end_sample = trs.sample_index;
                    bit_object.value = 1;
                    t1h = false;
                    bit_cnt++;

                    if (chip.bit_time > 0)
                    {
                        if ((bit_object.end_sample - bit_object.st_sample) > (bit_time_max * sample_rate))
                        {
                            ScanaStudio.dec_item_new(ch, bit_object.st_sample, bit_object.end_sample);
                            ScanaStudio.dec_item_emphasize_warning();
                            ScanaStudio.dec_item_end();
                        }
                        else if ((bit_object.end_sample - bit_object.st_sample) < (bit_time_min * sample_rate))
                        {
                            ScanaStudio.dec_item_new(ch, bit_object.st_sample, bit_object.end_sample);
                            ScanaStudio.dec_item_emphasize_warning();
                            ScanaStudio.dec_item_end();
                        }
                    }

                    decode_word(bit_object);
                }
                else
                {
                    ScanaStudio.dec_item_new(ch, trs_last.sample_index, trs.sample_index);
                    ScanaStudio.dec_item_add_content("WRONG BIT STATE");
                    ScanaStudio.dec_item_add_content("WRONG");
                    ScanaStudio.dec_item_add_content("!");
                    ScanaStudio.dec_item_emphasize_error();
                    ScanaStudio.dec_item_end();
                }
            }
            else
            {
                if(!ScanaStudio.trs_is_not_last(ch))
                {
                    if (t1h)
                    {
                        bit_object.end_sample = trs.sample_index;
                        bit_object.value = 1;
                        t1h = false;
                        bit_cnt++;

                        if (chip.bit_time > 0)
                        {
                            if ((bit_object.end_sample - bit_object.st_sample) > (bit_time_max * sample_rate))
                            {
                                ScanaStudio.dec_item_new(ch, bit_object.st_sample, bit_object.end_sample);
                                ScanaStudio.dec_item_emphasize_warning();
                                ScanaStudio.dec_item_end();
                            }
                            else if ((bit_object.end_sample - bit_object.st_sample) < (bit_time_min * sample_rate))
                            {
                                ScanaStudio.dec_item_new(ch, bit_object.st_sample, bit_object.end_sample);
                                ScanaStudio.dec_item_emphasize_warning();
                                ScanaStudio.dec_item_end();
                            }
                        }

                        decode_word(bit_object);
                    }
                    else if (t0h)
                    {
                        bit_object.end_sample = trs.sample_index;
                        bit_object.value = 0;
                        t0h = false;
                        bit_cnt++;

                        if (chip.bit_time > 0)
                        {
                            if ((bit_object.end_sample - bit_object.st_sample) > (bit_time_max * sample_rate))
                            {
                                ScanaStudio.dec_item_new(ch, bit_object.st_sample, bit_object.end_sample);
                                ScanaStudio.dec_item_emphasize_warning();
                                ScanaStudio.dec_item_end();
                            }
                            else if ((bit_object.end_sample - bit_object.st_sample) < (bit_time_min * sample_rate))
                            {
                                ScanaStudio.dec_item_new(ch, bit_object.st_sample, bit_object.end_sample);
                                ScanaStudio.dec_item_emphasize_warning();
                                ScanaStudio.dec_item_end();
                            }
                        }

                        decode_word(bit_object);
                    }
                }
                else
                {
                    ScanaStudio.dec_item_new(ch, trs_last.sample_index, trs.sample_index);
                    ScanaStudio.dec_item_add_content("WRONG T1L/T0L DURATION");
                    ScanaStudio.dec_item_add_content("WRONG");
                    ScanaStudio.dec_item_add_content("!");
                    ScanaStudio.dec_item_emphasize_error();
                    ScanaStudio.dec_item_end();
                }
            }
        }
    }while (ScanaStudio.trs_is_not_last(ch))
}

// ----------------------------------------------------------------------------
// Two-wire (clocked, APA102/SK9822-class) decoder
// ----------------------------------------------------------------------------

// Assemble an MSB-first byte from 8 entries of the bit array starting at off.
function clocked_bits_to_byte (bits, off)
{
    var byte = 0;
    for (var i = 0; i < 8; i++)
    {
        byte = (byte << 1) | (bits[off + i].v ? 1 : 0);
    }
    return byte;
}

// Push one bit into the current LED word; emit the LED once 32 bits are gathered.
function clocked_push_word_bit (s, v)
{
    clk_word.push({s: s, v: v});

    if (clk_word.length == 32)
    {
        clocked_emit_led(clk_word);
        clk_word = [];
    }
}

// Open a new frame at a detected start frame. [st, en] spans the 32 start-frame
// zero bits (en = sample of the last start-frame zero).
function clocked_open_frame (st, en)
{
    var q = Math.round(clk_period / 4);
    ScanaStudio.dec_item_new(ch, Math.max(0, st - q), en + q);
    ScanaStudio.dec_item_add_content("START FRAME");
    ScanaStudio.dec_item_add_content("START");
    ScanaStudio.dec_item_add_content("S");
    ScanaStudio.dec_item_end();

    ScanaStudio.packet_view_add_packet(true, ch, st, -1, "RGB LED", clocked_chip.str,
                                       ScanaStudio.get_channel_color(ch), ScanaStudio.get_channel_color(ch));
    ScanaStudio.packet_view_add_packet(false, ch, st, en, "Frame", "Start",
                                       ScanaStudio.PacketColors.Head.Title, ScanaStudio.PacketColors.Head.Content);

    frame_open = true;
    word_cnt = 0;
    clk_word = [];
}

// Close the current frame. Any bits still in clk_word are the end frame (DATA held
// high for ceil(N/2) clocks, per the WL-ICLED datasheet).
function clocked_close_frame ()
{
    if (!frame_open) return;

    if (clk_word.length > 0)
    {
        var q = Math.round(clk_period / 4);
        var st = Math.max(0, clk_word[0].s - q);
        var en = clk_word[clk_word.length - 1].s + q;

        ScanaStudio.dec_item_new(ch, st, en);
        ScanaStudio.dec_item_add_content("END FRAME");
        ScanaStudio.dec_item_add_content("END");
        ScanaStudio.dec_item_add_content("E");
        ScanaStudio.dec_item_end();

        ScanaStudio.packet_view_add_packet(false, ch, st, en, "Frame", "End",
                                           ScanaStudio.PacketColors.Head.Title, ScanaStudio.PacketColors.Head.Content);
    }

    frame_open = false;
    clk_word = [];
}

// Main per-sampled-bit handler. A start frame is 32 consecutive zero bits (valid
// LED data never holds 32 zeros in a row - a black, gain-0 LED is at most 29).
// Shorter zero runs belong to LED color bytes and are held 'pending' until the
// next '1' flushes them into the word. The data-high end frame is simply the high
// bits left in clk_word when the next start frame arrives.
function clocked_on_bit (s, v)
{
    // Track the clock period (spacing between consecutive rising edges) so item
    // boxes can be widened by a quarter clock.
    if (clk_prev_sample >= 0)
    {
        var d = s - clk_prev_sample;
        if (d > 0) clk_period = d;
    }
    clk_prev_sample = s;

    if (v == 0)
    {
        if (clk_pending.length == 0) clk_zero_start_sample = s;
        clk_pending.push(s);

        if (clk_pending.length >= 32)
        {
            var en = clk_pending[clk_pending.length - 1];

            if (frame_open)
            {
                // Extra start-frame zeros right after opening (no LEDs yet) are
                // just absorbed; otherwise close this frame and open the next.
                if (!(word_cnt == 0 && clk_word.length == 0))
                {
                    clocked_close_frame();
                    clocked_open_frame(clk_zero_start_sample, en);
                }
            }
            else
            {
                clocked_open_frame(clk_zero_start_sample, en);
            }

            clk_pending = [];
        }
        return;
    }

    // v == 1
    if (frame_open)
    {
        // Flush pending LED-data zeros (run < 32) into the word, then this '1'.
        for (var i = 0; i < clk_pending.length; i++)
        {
            clocked_push_word_bit(clk_pending[i], 0);
        }
        clk_pending = [];
        clocked_push_word_bit(s, 1);
    }
    else
    {
        // Not inside a frame yet: discard the short zero run, ignore stray ones.
        clk_pending = [];
    }
}

// Emit one decoded LED from a 32-bit word (control byte + 3 PWM bytes).
function clocked_emit_led (bits)
{
    // Ignore a truncated last LED: if its final bit cell isn't fully within the
    // captured data, emit nothing (no decoder item, no current plot).
    if ((bits[31].s + clk_period) > ScanaStudio.get_available_samples()) return;

    var q = Math.round(clk_period / 4);
    var item_st = Math.max(0, bits[0].s - q);
    var item_end = bits[31].s + q;

    var control = clocked_bits_to_byte(bits, 0);
    var flag = (control >> 5) & 0x07;
    var gain = control & 0x1F;
    var b0 = clocked_bits_to_byte(bits, 8);
    var b1 = clocked_bits_to_byte(bits, 16);
    var b2 = clocked_bits_to_byte(bits, 24);

    var c = map_color_bytes(clocked_chip.order, b0, b1, b2);

    // Scale the displayed color and the estimated current by the 5-bit global
    // brightness (gain / 31).
    var scale = gain / 31;
    var r = Math.round(c.r * scale);
    var g = Math.round(c.g * scale);
    var b = Math.round(c.b * scale);

    var rgb_hex = "#" + r.toString(16).toUpperCase().pad() +
                        g.toString(16).toUpperCase().pad() +
                        b.toString(16).toUpperCase().pad();
    var rgb = (disp_format == 16) ? rgb_hex
                                  : (r.toString(10) + " " + g.toString(10) + " " + b.toString(10));

    word_cnt++;
    var title = "LED " + word_cnt;

    ScanaStudio.dec_item_new(ch, item_st, item_end);
    ScanaStudio.dec_item_add_content(title + ": " + rgb + " (br " + gain + "/31)");
    ScanaStudio.dec_item_add_content(rgb + " br" + gain);
    ScanaStudio.dec_item_add_content(rgb);
    for (var sp = 0; sp < 32; sp++)
    {
        ScanaStudio.dec_item_add_sample_point(bits[sp].s, bits[sp].v ? "1" : "0");
    }
    if (flag != 0x07) // control byte should be 111ggggg
    {
        ScanaStudio.dec_item_emphasize_warning();
    }
    ScanaStudio.dec_item_end();

    ScanaStudio.packet_view_add_packet(false, ch, item_st, item_end, title, rgb + " (br " + gain + ")",
                                       ScanaStudio.get_channel_color(ch), rgb_hex);

    plot_led_current(word_cnt - 1, r, g, b, item_end);
}

function decode_signals_clocked (resume)
{
    if (!resume)
    {
        sample_rate = ScanaStudio.get_capture_sample_rate();
        ch = Number(ScanaStudio.gui_get_value("ch"));
        ch_clk = Number(ScanaStudio.gui_get_value("ch_clk"));

        clk_zero_start_sample = 0;
        clk_pending = [];
        clk_word = [];
        clk_prev_sample = -1;
        clk_period = 0;
        word_cnt = 0;
        frame_open = false;

        setup_current_vac();

        ScanaStudio.trs_reset(ch_clk);
    }

    while (ScanaStudio.trs_is_not_last(ch_clk))
    {
        if (ScanaStudio.abort_is_requested()) return;

        clk_trs = ScanaStudio.trs_get_next(ch_clk);

        if (clk_trs.value != 1) continue; // sample data on the rising clock edge only

        var v = ScanaStudio.trs_get_before(ch, clk_trs.sample_index).value;
        clocked_on_bit(clk_trs.sample_index, v);
    }
}

function decode_word (bit_object)
{
    var bit_value = 0;
    var word_value = 0;
    var r = 0, g = 0, b = 0;
    var title = "", rgb = "";
    var title_clr = ScanaStudio.get_channel_color(ch);

    bitstream_arr.push(bit_object);

    if (bitstream_arr.length > 23)
    {
        var item_st = bitstream_arr[0].st_sample;
        var item_end = bitstream_arr[23].end_sample;

        // Ignore a truncated last LED that runs past the captured data: emit
        // nothing (no decoder item, no current plot).
        if (item_end > ScanaStudio.get_available_samples())
        {
            bitstream_arr = [];
            return;
        }

        // Capture per-bit sample points (value + position) before the array is
        // consumed below, so we can draw them as dots on the decoded item.
        var sample_pts = [];
        for (i = 0; i < 24; i++)
        {
            var bo = bitstream_arr[i];
            sample_pts.push({s: Math.round((bo.st_sample + bo.end_sample) / 2), v: bo.value});
        }

        for (i = 0; i < 8; i++)
        {
            bit_value = bitstream_arr.pop().value;
            b |= (bit_value << i);
        }

        for (i = 0; i < 8; i++)
        {
            bit_value = bitstream_arr.pop().value;
            g |= (bit_value << i);
        }

        for (i = 0; i < 8; i++)
        {
            bit_value = bitstream_arr.pop().value;
            r |= (bit_value << i);
        }

        if (chip.clr_order == "GRB")
        {
            var temp = r;
            r = g;
            g = temp;
        }

        var rgb_hex = "#" + r.toString(16).toUpperCase().pad() +
                            g.toString(16).toUpperCase().pad() +
                            b.toString(16).toUpperCase().pad();

        var rgb_dec = r.toString(10) + " " +
                      g.toString(10) + " " +
                      b.toString(10);

        if (disp_format == 16)
        {
            rgb = rgb_hex;
        }
        else
        {
            rgb = rgb_dec;
        }

        // Open the frame's parent packet on its first LED so children nest under
        // it (the reset child is added later when the frame terminates).
        if (word_cnt == 0)
        {
            ScanaStudio.packet_view_add_packet(true, ch, item_st, -1, "RGB LED", chip.str,
                                               ScanaStudio.get_channel_color(ch), ScanaStudio.get_channel_color(ch));
            frame_open = true;
        }

        word_cnt++;
        title = "LED " + word_cnt;

        ScanaStudio.dec_item_new(ch, item_st, item_end);
        ScanaStudio.dec_item_add_content(title + ": " + rgb);
        ScanaStudio.dec_item_add_content(rgb);
        for (i = 0; i < sample_pts.length; i++)
        {
            ScanaStudio.dec_item_add_sample_point(sample_pts[i].s, sample_pts[i].v ? "1" : "0");
        }
        ScanaStudio.dec_item_end();

        ScanaStudio.packet_view_add_packet(false, ch, item_st, item_end, title, rgb, title_clr, rgb_hex);

        // Plot this LED's estimated current on its own graph (word_cnt-1 = LED index).
        plot_led_current(word_cnt - 1, r, g, b, item_end);

        bitstream_arr = [];
    }
}

// ----------------------------------------------------------------------------
// Test routine helpers (shared by the demo signals and the pattern generator)
// ----------------------------------------------------------------------------

// Animation indexes, must match the "anim" combo box order below.
var ANIM_COLOR_LIST = 0;
var ANIM_SOLID      = 1;
var ANIM_CHASE      = 2;
var ANIM_RAINBOW    = 3;
var ANIM_BLINK      = 4;

// Parse a comma separated list of "#RRGGBB" (or "RRGGBB") colors into an array
// of {r,g,b} objects. Returns null on the first malformed entry.
function parse_color_list (str)
{
    var palette = [];
    var parts = String(str).split(",");

    for (var i = 0; i < parts.length; i++)
    {
        var s = parts[i].replace(/\s/g, "").replace(/^#/, "");

        if (s.length == 0) continue;
        if (s.length != 6 || /[^0-9a-fA-F]/.test(s)) return null;

        palette.push({
            r: parseInt(s.substr(0, 2), 16),
            g: parseInt(s.substr(2, 2), 16),
            b: parseInt(s.substr(4, 2), 16)
        });
    }

    if (palette.length == 0) return null;
    return palette;
}

// Minimal HSV (h,s,v in [0..1]) to {r,g,b} [0..255] conversion (for the rainbow).
function hsv_to_rgb (h, s, v)
{
    h = (h - Math.floor(h)) * 6;
    var i = Math.floor(h);
    var f = h - i;
    var p = v * (1 - s);
    var q = v * (1 - s * f);
    var t = v * (1 - s * (1 - f));
    var r, g, b;

    switch (i % 6)
    {
        case 0: r = v; g = t; b = p; break;
        case 1: r = q; g = v; b = p; break;
        case 2: r = p; g = v; b = t; break;
        case 3: r = p; g = q; b = v; break;
        case 4: r = t; g = p; b = v; break;
        default: r = v; g = p; b = q; break;
    }

    return {
        r: Math.round(r * 255),
        g: Math.round(g * 255),
        b: Math.round(b * 255)
    };
}

// Build the color array ({r,g,b}[]) for a single frame of an animation.
function build_frame (anim, frame_idx, num_leds, palette, num_frames)
{
    var leds = [];
    var off = {r: 0, g: 0, b: 0};
    var i;

    for (i = 0; i < num_leds; i++)
    {
        switch (anim)
        {
            case ANIM_SOLID:
                leds.push(palette[0]);
                break;

            case ANIM_CHASE:
                leds.push((i == (frame_idx % num_leds)) ? palette[0] : off);
                break;

            case ANIM_RAINBOW:
                leds.push(hsv_to_rgb((i / num_leds) + (frame_idx / num_frames), 1, 1));
                break;

            case ANIM_BLINK:
                leds.push((frame_idx % 2 == 0) ? palette[i % palette.length] : off);
                break;

            case ANIM_COLOR_LIST:
            default:
                leds.push(palette[i % palette.length]);
                break;
        }
    }

    return leds;
}

//Function called to generate demo siganls (when no physical device is attached)
function on_build_demo_signals()
{
    var builder = ScanaStudio.BuilderObject;
    var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
    var sample_rate = ScanaStudio.builder_get_sample_rate();
    var ch = Number(ScanaStudio.gui_get_value("ch"));
    var iface = Number(ScanaStudio.gui_get_value("interface"));

    // Default demo routine: a rolling rainbow over a short chain, so the decoded
    // colors are recognizable in the packet view.
    var num_leds = 8;
    var num_frames = 60;
    var palette = [{r: 255, g: 0, b: 0}, {r: 0, g: 255, b: 0}, {r: 0, g: 0, b: 255}];
    var f = 0;
    var i;

    if (iface == 1) // Two-wire (clocked)
    {
        var ch_clk = Number(ScanaStudio.gui_get_value("ch_clk"));
        var clk_chip = clocked_chips_in_order()[Number(ScanaStudio.gui_get_value("chip_clocked"))];
        var clk_freq = sample_rate / 20; // -> 10 samples per half clock
        var gain = 31;

        builder.config_clocked(ch, ch_clk, sample_rate, clk_freq, clk_chip.order);

        while (ScanaStudio.builder_get_samples_acc(ch) < samples_to_build)
        {
            if (ScanaStudio.abort_is_requested()) return;

            var leds_c = build_frame(ANIM_RAINBOW, f, num_leds, palette, num_frames);

            builder.put_clocked_start();
            for (i = 0; i < num_leds; i++)
            {
                builder.put_clocked_led(leds_c[i].r, leds_c[i].g, leds_c[i].b, gain);
            }
            builder.put_clocked_end(num_leds);
            f++;
        }

        return;
    }

    // Single-wire (NRZ)
    var chip = get_current_chip();

    builder.config(ch, sample_rate, chip);
    builder.put_silence_samples(chip.rst_time * sample_rate * 1.5); // clear initial reset

    while (ScanaStudio.builder_get_samples_acc(ch) < samples_to_build)
    {
        if (ScanaStudio.abort_is_requested()) return;

        var leds = build_frame(ANIM_RAINBOW, f, num_leds, palette, num_frames);

        for (i = 0; i < num_leds; i++)
        {
            builder.put_color(leds[i].r, leds[i].g, leds[i].b);
        }

        builder.put_reset();
        f++;
    }
}

// ----------------------------------------------------------------------------
// Pattern generator (build simple test routines on a real device)
// ----------------------------------------------------------------------------
// Pattern generator GUI - three-step wizard mirroring the decoder:
//  Page 0: interface choice.
//  Page 1: channels + chipset (+ clock/brightness for two-wire), conditioned.
//  Page 2: test routine (LED count, animation, color list, frames).
function on_get_n_pages_gui_pattern_generator()
{
    return 3;
}

function on_draw_gui_pattern_generator(page_number)
{
    if (page_number == 0)
    {
        ScanaStudio.gui_add_info_label("Step 1: choose the LED interface to generate.", page_number);

        ScanaStudio.gui_add_combo_box("interface_gen", "LED interface", page_number);
            ScanaStudio.gui_add_item_to_combo_box("Single-wire (NRZ)", true);
            ScanaStudio.gui_add_item_to_combo_box("Two-wire (clocked, APA102 / WL-ICLED dual)", false);

        return;
    }

    if (page_number == 1)
    {
        var iface = Number(ScanaStudio.gui_get_value("interface_gen"));

        if (iface == 1) // Two-wire (clocked)
        {
            ScanaStudio.gui_add_info_label("Step 2: two-wire channels, chipset and clock.", page_number);

            ScanaStudio.gui_add_ch_selector("ch_gen", "Data line (DIN)", "DIN", 0, page_number);
            ScanaStudio.gui_add_ch_selector("ch_clk_gen", "Clock line (CIN)", "CLK", 1, page_number);

            ScanaStudio.gui_add_combo_box("chip_clocked_gen", "Chipset", page_number);
            var clk_chips = clocked_chips_in_order();
            for (var j = 0; j < clk_chips.length; j++)
            {
                ScanaStudio.gui_add_item_to_combo_box(clk_chips[j].str, (j == 0));
            }

            ScanaStudio.gui_add_engineering_form_input_box("clk_freq", "Clock frequency", 1e3, 16e6, 1e6, "Hz", page_number);
            ScanaStudio.gui_add_text_input("gain", "Global brightness (0-31)", "31", page_number);
        }
        else // Single-wire (NRZ)
        {
            ScanaStudio.gui_add_info_label("Step 2: single-wire channel and chipset.", page_number);

            ScanaStudio.gui_add_ch_selector("ch_gen", "Data line (DIN)", "DIN", 0, page_number);

            ScanaStudio.gui_add_combo_box("chip_gen", "Chipset", page_number);
            var chips = chips_in_order();
            for (var i = 0; i < chips.length; i++)
            {
                ScanaStudio.gui_add_item_to_combo_box(chips[i].str, (chips[i].str == "WL-ICLED"));
            }
        }

        return;
    }

    // page_number == 2 : test routine.
    ScanaStudio.gui_add_info_label("Step 3: build the test routine.", page_number);

    ScanaStudio.gui_add_text_input("num_leds", "Number of LEDs in chain", "8", page_number);

    ScanaStudio.gui_add_combo_box("anim", "Test routine", page_number);
        ScanaStudio.gui_add_item_to_combo_box("Color list", true);
        ScanaStudio.gui_add_item_to_combo_box("Solid fill", false);
        ScanaStudio.gui_add_item_to_combo_box("Chase / running light", false);
        ScanaStudio.gui_add_item_to_combo_box("Rainbow", false);
        ScanaStudio.gui_add_item_to_combo_box("Blink", false);

    ScanaStudio.gui_add_text_input("color_list", "RGB sequence (hex, comma separated)", "#FF0000,#00FF00,#0000FF", page_number);
    ScanaStudio.gui_add_info_label("The color list is mapped across the chain (repeating if shorter than the chain). For Solid/Chase/Blink the first color is used as the base color.", page_number);

    ScanaStudio.gui_add_text_input("num_frames", "Number of frames", "30", page_number);
    ScanaStudio.gui_add_engineering_form_input_box("frame_delay", "Extra delay between frames", 0.001, 1, 0.01, "s", page_number);
}

function on_eval_gui_pattern_generator(page_number)
{
    if (page_number == 1)
    {
        ScanaStudio.set_script_instance_name("RGB LED generator on CH " + (Number(ScanaStudio.gui_get_value("ch_gen")) + 1));

        if (Number(ScanaStudio.gui_get_value("interface_gen")) == 1)
        {
            var gain = Number(ScanaStudio.gui_get_value("gain"));
            if (!(gain >= 0 && gain <= 31)) return "Global brightness must be between 0 and 31";
        }
    }

    if (page_number == 2)
    {
        if (!(Number(ScanaStudio.gui_get_value("num_leds")) >= 1)) return "Number of LEDs must be at least 1";
        if (!(Number(ScanaStudio.gui_get_value("num_frames")) >= 1)) return "Number of frames must be at least 1";
        if (parse_color_list(ScanaStudio.gui_get_value("color_list")) == null)
        {
            return "Invalid RGB sequence: use comma separated #RRGGBB values (e.g. #FF0000,#00FF00)";
        }
    }

    return ""; //All good.
}

function on_pattern_generate()
{
    var builder = ScanaStudio.BuilderObject;
    var clocked = (Number(ScanaStudio.gui_get_value("interface_gen")) == 1);
    var ch = Number(ScanaStudio.gui_get_value("ch_gen"));
    var sample_rate = ScanaStudio.builder_get_sample_rate();
    var num_leds = Math.floor(Number(ScanaStudio.gui_get_value("num_leds")));
    var num_frames = Math.floor(Number(ScanaStudio.gui_get_value("num_frames")));
    var anim = Number(ScanaStudio.gui_get_value("anim"));
    var palette = parse_color_list(ScanaStudio.gui_get_value("color_list"));
    var extra_delay_samples = Math.round(Number(ScanaStudio.gui_get_value("frame_delay")) * sample_rate);

    var ch_clk = 0, gain = 31;

    if (clocked)
    {
        // ch_clk_gen only exists in two-wire mode - read it here, not unconditionally.
        ch_clk = Number(ScanaStudio.gui_get_value("ch_clk_gen"));
        var clk_chip = clocked_chips_in_order()[Number(ScanaStudio.gui_get_value("chip_clocked_gen"))];
        var clk_freq = Number(ScanaStudio.gui_get_value("clk_freq"));
        gain = Math.floor(Number(ScanaStudio.gui_get_value("gain"))) & 0x1F;

        builder.config_clocked(ch, ch_clk, sample_rate, clk_freq, clk_chip.order);

        ScanaStudio.builder_set_out_voltage(ch, 5000);
        ScanaStudio.builder_set_idle_state(ch, 0);
        ScanaStudio.builder_set_io(ch, ScanaStudio.io_type.push_pull);
        ScanaStudio.builder_set_out_voltage(ch_clk, 5000);
        ScanaStudio.builder_set_idle_state(ch_clk, 0);
        ScanaStudio.builder_set_io(ch_clk, ScanaStudio.io_type.push_pull);
    }
    else
    {
        var chip = chips_in_order()[Number(ScanaStudio.gui_get_value("chip_gen"))];
        builder.config(ch, sample_rate, chip);

        // Electrical settings (WL-ICLED and most addressable LEDs run at 5V, push-pull).
        ScanaStudio.builder_set_out_voltage(ch, 5000);
        ScanaStudio.builder_set_idle_state(ch, 0);
        ScanaStudio.builder_set_io(ch, ScanaStudio.io_type.push_pull);

        builder.put_reset();
    }

    // Build every frame into a single chunk, then send it once. Emitting one chunk
    // per frame caused only the first frame to be generated on the device.
    for (var f = 0; f < num_frames; f++)
    {
        if (ScanaStudio.abort_is_requested()) return;

        var leds = build_frame(anim, f, num_leds, palette, num_frames);

        if (clocked)
        {
            builder.put_clocked_start();
            for (var i = 0; i < num_leds; i++)
            {
                builder.put_clocked_led(leds[i].r, leds[i].g, leds[i].b, gain);
            }
            builder.put_clocked_end(num_leds);

            if (extra_delay_samples > 0)
            {
                // Keep both lines idle low during the inter-frame gap.
                ScanaStudio.builder_add_samples(ch, 0, extra_delay_samples);
                ScanaStudio.builder_add_samples(ch_clk, 0, extra_delay_samples);
            }
        }
        else
        {
            for (var i = 0; i < num_leds; i++)
            {
                builder.put_color(leds[i].r, leds[i].g, leds[i].b);
            }
            builder.put_reset();

            if (extra_delay_samples > 0)
            {
                builder.put_silence_samples(extra_delay_samples);
            }
        }

        ScanaStudio.report_progress((f * 100) / num_frames);
    }

    ScanaStudio.builder_start_chunk();
    ScanaStudio.builder_wait_done(500);
}

//Builder object that can be shared to other scripts
ScanaStudio.BuilderObject =
{
    //to be configured by the user of this object using the setter functions below
    channel: 0,
    chip: null,
    sample_rate: 0,

    put_rgb : function (word)
    {
        var i = 0;
        var bit_value = 0;

        for (i = 0; i < 24; i++)
        {
            bit_value = ((word >> i) & 0x1);
            this.put_bit(bit_value);
        }
    },

    // Emit one LED (24 bits) from individual r/g/b values [0..255], honoring the
    // chipset color order. Each byte is sent MSB first, which is what decode_word()
    // expects, so a generated color decodes back to the same color.
    put_byte_msb : function (byte)
    {
        for (var bit = 7; bit >= 0; bit--)
        {
            this.put_bit((byte >> bit) & 0x1);
        }
    },

    put_color : function (r, g, b)
    {
        r &= 0xFF; g &= 0xFF; b &= 0xFF;

        if (this.chip.clr_order == "GRB")
        {
            this.put_byte_msb(g);
            this.put_byte_msb(r);
            this.put_byte_msb(b);
        }
        else // RGB
        {
            this.put_byte_msb(r);
            this.put_byte_msb(g);
            this.put_byte_msb(b);
        }
    },

    put_bit : function (bit_value)
    {
        if (bit_value > 0)
        {
            ScanaStudio.builder_add_samples(this.channel, 1, (this.chip.t1h * this.sample_rate));
            ScanaStudio.builder_add_samples(this.channel, 0, (this.chip.t1l * this.sample_rate));
        }
        else
        {
            ScanaStudio.builder_add_samples(this.channel, 1, (this.chip.t0h * this.sample_rate));
            ScanaStudio.builder_add_samples(this.channel, 0, (this.chip.t0l * this.sample_rate));
        }
    },

    put_reset : function()
    {
        ScanaStudio.builder_add_samples(this.channel, 0, (this.chip.rst_time * this.sample_rate));
    },

    put_silence_samples : function (samples)
    {
        ScanaStudio.builder_add_samples(this.channel, 0, samples);
    },

    config : function (channel, sample_rate, chip)
    {
        this.channel = channel;
        this.sample_rate = sample_rate;
        this.chip = chip;
    },

    // ----- Two-wire (clocked, APA102/SK9822-class) builder -----
    data_channel: 0,
    clk_channel: 1,
    clk_order: "BGR",
    samples_per_half_clock: 1,

    config_clocked : function (data_channel, clk_channel, sample_rate, clk_freq, order)
    {
        this.data_channel = data_channel;
        this.clk_channel = clk_channel;
        this.sample_rate = sample_rate;
        this.clk_order = order;
        this.samples_per_half_clock = Math.max(1, Math.round(sample_rate / clk_freq / 2));
    },

    // One clocked bit: data is held stable for a full clock period; the clock goes
    // low for the first half then high for the second half, so the rising edge in
    // the middle samples valid data (SPI mode 0).
    put_clocked_bit : function (bit)
    {
        var b = bit ? 1 : 0;
        ScanaStudio.builder_add_samples(this.data_channel, b, this.samples_per_half_clock);
        ScanaStudio.builder_add_samples(this.clk_channel, 0, this.samples_per_half_clock);
        ScanaStudio.builder_add_samples(this.data_channel, b, this.samples_per_half_clock);
        ScanaStudio.builder_add_samples(this.clk_channel, 1, this.samples_per_half_clock);
    },

    put_clocked_byte : function (byte)
    {
        for (var bit = 7; bit >= 0; bit--)
        {
            this.put_clocked_bit((byte >> bit) & 0x1);
        }
    },

    put_clocked_start : function ()
    {
        for (var i = 0; i < 32; i++) this.put_clocked_bit(0);
    },

    put_clocked_led : function (r, g, b, gain)
    {
        var control = 0xE0 | (gain & 0x1F); // 111ggggg
        var bytes = color_to_bytes(this.clk_order, r, g, b);
        this.put_clocked_byte(control);
        this.put_clocked_byte(bytes[0]);
        this.put_clocked_byte(bytes[1]);
        this.put_clocked_byte(bytes[2]);
    },

    put_clocked_end : function (n_leds)
    {
        // End frame: ceil(N/2) clock cycles with DATA held HIGH (per WL-ICLED
        // datasheet). The decoder then sees the next start frame's 32 zeros.
        var cycles = Math.ceil(n_leds / 2);
        if (cycles < 1) cycles = 1;
        for (var i = 0; i < cycles; i++) this.put_clocked_bit(1);
    },
};
