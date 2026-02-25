/* Protocol meta info:
<NAME> State Machine </NAME>
<DESCRIPTION>
Parallel state machine decoder with configurable bit width (1-8 bits).
Samples parallel data lines on clock edges and displays decoded states
with user-defined names. Supports clockless mode with edge-based
transition detection and configurable debounce buffer.
Supports importing state names from a TXT file.
Uses forward-only iterators for high-performance decoding.
</DESCRIPTION>
<VERSION> 1.1 </VERSION>
<AUTHOR_NAME> Ibrahim KAMAL </AUTHOR_NAME>
<AUTHOR_URL> i.kamal@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright Ibrahim KAMAL </COPYRIGHT>
<LICENSE> This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V1.1: Added clockless mode with edge-based transition detection and configurable debounce buffer.
V1.0: Initial release.
</RELEASE_NOTES>
*/

//Global variables - Configuration
var num_bits;
var data_format;
var bit_order;
var clk_edge;
var color_per_state;
var ignore_clock;
var transition_buffer;

//Global variables - Channels
var ch_clk;
var ch_data = [];
var ch_out; // Channel to draw decoded items on

//Global variables - State names
var state_names = [];
var state_colors = [];  // Per-state colors for packet view
//Global variables - Fast iterator state
var data_trs = [];       // Current transition for each data channel
var data_trs_value = []; // Current logic value (before next transition) for each channel
var data_trs_done = [];  // Whether iterator has reached end for each channel

//Global variables - Decoding state
var sampling_rate;

//Global variables - Clockless decode state (persists across resume calls)
var clockless_prev_state;
var clockless_prev_stable_sample;
var clockless_buffer_samples;

//Global variables - Clock-based decode state (persists across resume calls)
var clk_prev_active_sample;
var clk_prev_state_value;

//Constants
var EDGE_RISING = 0;
var EDGE_FALLING = 1;
var EDGE_BOTH = 2;

var FORMAT_HEX = 0;
var FORMAT_BINARY = 1;
var FORMAT_DECIMAL = 2;

var ENCODING = "UTF-8";

function on_get_n_pages_gui_decoder() {
    return 3;
}

//Decoder GUI
function on_draw_gui_decoder(page_number) {
    switch (page_number) {
        case 0:
            // Page 0: Configuration
            ScanaStudio.gui_add_info_label("Step 1: State Machine Configuration", page_number);

            // Number of bits (1-8)
            ScanaStudio.gui_add_combo_box("num_bits", "Number of state bits", page_number);
            for (var i = 1; i <= 8; i++) {
                ScanaStudio.gui_add_item_to_combo_box(i.toString() + " bit" + (i > 1 ? "s" : "") + " (" + (1 << i) + " states)", (i == 4));
            }

            // Data format
            ScanaStudio.gui_add_combo_box("data_format", "Data format", page_number);
            ScanaStudio.gui_add_item_to_combo_box("Hexadecimal", true);
            ScanaStudio.gui_add_item_to_combo_box("Binary", false);
            ScanaStudio.gui_add_item_to_combo_box("Decimal", false);

            // Bit order
            ScanaStudio.gui_add_combo_box("bit_order", "Bit order", page_number);
            ScanaStudio.gui_add_item_to_combo_box("MSB first (D0 = MSB)", true);
            ScanaStudio.gui_add_item_to_combo_box("LSB first (D0 = LSB)", false);

            ScanaStudio.gui_add_separator("", page_number);

            // Clock mode selection
            ScanaStudio.gui_add_new_selectable_containers_group("clock_mode", "Clock mode", page_number);

            // Container 0: Clock signal available (default)
            ScanaStudio.gui_add_new_container("Clock signal available", true, page_number);
            ScanaStudio.gui_add_combo_box("clk_edge", "Sample data on", page_number);
            ScanaStudio.gui_add_item_to_combo_box("Rising edge", true);
            ScanaStudio.gui_add_item_to_combo_box("Falling edge", false);
            ScanaStudio.gui_add_item_to_combo_box("Both edges (DDR)", false);
            ScanaStudio.gui_end_container();

            // Container 1: Clock not available
            ScanaStudio.gui_add_new_container("Clock not available", false, page_number);
            ScanaStudio.gui_add_engineering_form_input_box("transition_buffer", "Transition buffer period", 1e-9, 1, 1e-6, "s", page_number);
            ScanaStudio.gui_end_container();

            ScanaStudio.gui_end_selectable_containers_group();

            break;

        case 1:
            // Page 1: Channel Assignment & File Import
            ScanaStudio.gui_add_info_label("Step 2: Channel Assignment", page_number);

            // Get configuration from page 0
            num_bits = ScanaStudio.gui_get_value("num_bits") + 1; // 0->1, 1->2, etc.
            var clock_mode = ScanaStudio.gui_get_value("clock_mode"); // 0 = clock available, 1 = clock not available

            // Clock channel (only if clock is available)
            if (clock_mode == 0) {
                ScanaStudio.gui_add_ch_selector("ch_clk", "Clock channel", "CLK", 0, page_number);
            }

            // Data bit channels
            var data_ch_offset = (clock_mode == 0) ? 1 : 0; // Start from ch0 if no clock
            for (var i = 0; i < num_bits; i++) {
                ScanaStudio.gui_add_ch_selector("ch_d" + i,
                    "Data bit " + i,
                    "D" + i,
                    Math.min(i + data_ch_offset, ScanaStudio.get_device_channels_count() - 1),
                    page_number);
            }

            ScanaStudio.gui_add_separator("", page_number);
            //ScanaStudio.gui_add_new_selectable_containers_group(state_names, "State Names Definition", page_number);
            //ScanaStudio.gui_add_new_container("Load State Names from File", false, page_number);
            ScanaStudio.gui_add_info_label("Load a TXT file with one state name per line.\nLine 1 = State 0, Line 2 = State 1, etc.\nLeave empty to keep current state names.", page_number);
            // File load
            ScanaStudio.gui_add_file_load("state_file", "State definitions file (TXT)", "*.txt", page_number);
            //ScanaStudio.gui_end_container();
            //ScanaStudio.gui_add_new_container("Set State Names in GUI", true, page_number);
            // ScanaStudio.gui_add_info_label("Set state names in next page" /* string */);
            //ScanaStudio.gui_end_container();
            //ScanaStudio.gui_end_selectable_containers_group();

            ScanaStudio.gui_add_separator("", page_number);
            ScanaStudio.gui_add_check_box("color_per_state", "Attribute different color for each state in packet view", true, page_number);

            break;

        case 2:
            // Page 2: State Names Editor
            ScanaStudio.gui_add_info_label("Step 3: Refine State Names", page_number);

            // Get configuration
            num_bits = ScanaStudio.gui_get_value("num_bits") + 1;
            var num_states = 1 << num_bits;

            // Load state names from file if one was provided
            var file_names = [];
            var file_path = ScanaStudio.gui_get_value("state_file");
            if (file_path && file_path.toString().trim().length > 0) {
                file_names = load_state_names_from_file(file_path.toString().trim(), num_states);
            }

            // Create text inputs for each state
            // Default values come from file if loaded, otherwise STATE_N placeholders.
            // ScanaStudio preserves user-edited values automatically.
            for (var i = 0; i < num_states; i++) {
                var default_name = (file_names.length > i && file_names[i].length > 0) ? file_names[i] : "STATE_" + i;
                var state_label = "State " + i + " (" + format_value(i, ScanaStudio.gui_get_value("data_format"), num_bits) + ")";
                ScanaStudio.gui_add_text_input("state_name_" + i, state_label, default_name, page_number);
            }

            break;

        default:
            break;
    }
}

//Evaluate decoder GUI
function on_eval_gui_decoder(page_number) {
    num_bits = ScanaStudio.gui_get_value("num_bits") + 1;
    var clock_mode = get_gui_value_safe("clock_mode", 0); // 0 = clock available, 1 = clock not available

    // Calculate minimum required channels
    var required_channels = (clock_mode == 0) ? (1 + num_bits) : num_bits;

    if (ScanaStudio.get_device_channels_count() < required_channels) {
        return "This configuration requires at least " + required_channels + " channels. " +
            "Your device only has " + ScanaStudio.get_device_channels_count() + " channels.";
    }

    // Validate channel uniqueness only on page 1 (where channel selectors are)
    if (page_number == 1) {
        var channel_usage = {}; // Maps channel number to description

        // Helper function to check and register channel usage
        function check_channel(ch, description) {
            if (ch === undefined || ch < 0) {
                return null;
            }
            if (channel_usage[ch] !== undefined) {
                return "Channel " + ch + " is assigned to both '" + channel_usage[ch] + "' and '" + description + "'. Each channel can only be used once.";
            }
            channel_usage[ch] = description;
            return null;
        }

        // Check clock channel (only if clock is available)
        if (clock_mode == 0) {
            var ch_clk_val = ScanaStudio.gui_get_value("ch_clk");
            var err = check_channel(ch_clk_val, "Clock");
            if (err) return err;
        }

        // Check data channels
        for (var i = 0; i < num_bits; i++) {
            var ch = ScanaStudio.gui_get_value("ch_d" + i);
            var err = check_channel(ch, "Data bit " + i);
            if (err) return err;
        }
    }

    // Validate state names on page 2
    if (page_number == 2) {
        var num_states = 1 << num_bits;
        for (var i = 0; i < num_states; i++) {
            var name = ScanaStudio.gui_get_value("state_name_" + i);
            if (!name || name.length == 0) {
                return "State " + i + " name cannot be empty.";
            }
        }
    }

    return ""; // All good
}

/**
 * Load state names from a TXT file.
 * Each line in the file corresponds to a state (line 1 = state 0, etc.)
 * Missing or empty lines are filled with "STATE_N" placeholders.
 */
function load_state_names_from_file(file_path, num_states) {
    var names = [];

    try {
        var file = ScanaStudio.file_system_open(file_path, "r");
        if (file < 0) {
            return []; // File couldn't be opened
        }

        var data = ScanaStudio.file_system_read_text(file, ENCODING);
        ScanaStudio.file_system_close(file);

        if (!data || data.length == 0) {
            ScanaStudio.console_error_msg("File is empty: " + file_path);
            return []; // Empty file
        }

        // Split into lines
        var lines = data.match(/[^\r\n]+/g);
        if (!lines || lines.length == 0) {
            return []; // No valid lines
        }

        // Build names array
        for (var i = 0; i < num_states; i++) {
            if (i < lines.length && lines[i].trim().length > 0) {
                names.push(lines[i].trim());
            } else {
                names.push("STATE_" + i);
            }
        }
    } catch (e) {
        return []; // On error, return empty to signal failure
    }

    return names;
}

/**
 * Initialize forward-only iterators for all data channels.
 * This must be called once at the start of decoding.
 */
function init_fast_iterators() {
    data_trs = [];
    data_trs_value = [];
    data_trs_done = [];

    for (var i = 0; i < ch_data.length; i++) {
        ScanaStudio.trs_reset(ch_data[i]);
        var trs = ScanaStudio.trs_get_next(ch_data[i]);
        data_trs.push(trs);
        // Initial value is opposite of first transition's target
        data_trs_value.push(1 - trs.value);
        data_trs_done.push(false);
    }
}

/**
 * Capture parallel data using fast forward-only iterators.
 * Advances each channel's iterator forward until it passes the target sample_index.
 * 
 * @param sample_index - The sample point at which to capture data
 * @returns The captured parallel value
 */
function capture_parallel_data_fast(sample_index) {
    var value = 0;
    var n = ch_data.length;

    for (var i = 0; i < n; i++) {
        // Advance iterator forward while current transition is at or before sample_index
        while (!data_trs_done[i] && data_trs[i].sample_index <= sample_index) {
            data_trs_value[i] = data_trs[i].value;

            if (ScanaStudio.trs_is_not_last(ch_data[i])) {
                data_trs[i] = ScanaStudio.trs_get_next(ch_data[i]);
            } else {
                data_trs_done[i] = true;
            }
        }

        var bit = data_trs_value[i];

        if (bit_order == 1) {
            // LSB first: bit 0 is in ch_data[0]
            value |= (bit << i);
        } else {
            // MSB first: bit 0 is in ch_data[n-1]
            value |= (bit << (n - 1 - i));
        }
    }

    return value;
}

/**
 * Format a value according to the selected data format.
 */
function format_value(value, format, bits) {
    switch (format) {
        case FORMAT_HEX:
            var hex_digits = Math.ceil(bits / 4);
            return "0x" + value.toString(16).toUpperCase().lpad("0", hex_digits);
        case FORMAT_BINARY:
            return "0b" + value.toString(2).lpad("0", bits);
        case FORMAT_DECIMAL:
        default:
            return value.toString(10);
    }
}

/**
 * Generate distinct colors for each state using HSL color space.
 * Returns array of {title, content} hex color strings.
 */
function generate_state_colors(num_states) {
    var colors = [];
    for (var i = 0; i < num_states; i++) {
        var hue = Math.round((i * 360) / num_states) % 360;
        // Title: darker/more saturated, Content: lighter/softer
        colors.push({
            title: hsl_to_hex(hue, 65, 35),
            content: hsl_to_hex(hue, 50, 75)
        });
    }
    return colors;
}

/**
 * Convert HSL to hex color string.
 * h: 0-360, s: 0-100, l: 0-100
 */
function hsl_to_hex(h, s, l) {
    s /= 100;
    l /= 100;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs((h / 60) % 2 - 1));
    var m = l - c / 2;
    var r, g, b;

    if (h < 60)      { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else              { r = c; g = 0; b = x; }

    r = Math.round((r + m) * 255);
    g = Math.round((g + m) * 255);
    b = Math.round((b + m) * 255);

    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
}

/**
 * Calculate centered decoder item bounds based on sampling interval.
 */
function get_decoder_item_bounds(sample_index, prev_sample_index) {
    var half_width;
    if (prev_sample_index !== null) {
        var interval = sample_index - prev_sample_index;
        half_width = Math.floor(interval * 0.45);
    } else {
        half_width = 1;
    }

    var start = sample_index - half_width;
    var end = sample_index + half_width;

    if (start < 0) {
        start = 0;
    }

    return { start: start, end: end };
}

/**
 * Check if the given edge value matches the configured clock edge setting.
 */
function check_edge(edge_value) {
    if (clk_edge == EDGE_RISING && edge_value == 1) {
        return true;
    } else if (clk_edge == EDGE_FALLING && edge_value == 0) {
        return true;
    } else if (clk_edge == EDGE_BOTH) {
        return true;
    }
    return false;
}

/**
 * Safely get GUI value with a default fallback.
 * Used when GUI items might not be configured yet (e.g., demo mode before full config).
 */
function get_gui_value_safe(id, default_value) {
    try {
        var val = ScanaStudio.gui_get_value(id);
        if (val === undefined || val === null) {
            return default_value;
        }
        return val;
    } catch (e) {
        return default_value;
    }
}

/**
 * Read channel assignments from GUI with safe defaults.
 * Returns object with ch_clk and ch_data array.
 */
function read_channel_assignments_safe() {
    var result = {
        ch_clk: ignore_clock ? -1 : get_gui_value_safe("ch_clk", 0),
        ch_data: []
    };

    var data_ch_offset = ignore_clock ? 0 : 1;
    for (var i = 0; i < num_bits; i++) {
        result.ch_data.push(get_gui_value_safe("ch_d" + i, Math.min(i + data_ch_offset, ScanaStudio.get_device_channels_count() - 1)));
    }

    return result;
}

function on_decode_signals(resume) {
    if (!resume) {
        // Initialization
        sampling_rate = ScanaStudio.get_capture_sample_rate();

        // Read GUI values (page 0 - always available)
        num_bits = get_gui_value_safe("num_bits", 3) + 1; // Default: 4 bits
        data_format = get_gui_value_safe("data_format", FORMAT_HEX);
        bit_order = get_gui_value_safe("bit_order", 0); // MSB first
        var clock_mode = get_gui_value_safe("clock_mode", 0);
        ignore_clock = (clock_mode == 1);
        clk_edge = ignore_clock ? EDGE_RISING : get_gui_value_safe("clk_edge", EDGE_RISING);
        transition_buffer = ignore_clock ? get_gui_value_safe("transition_buffer", 1e-6) : 0;
        color_per_state = get_gui_value_safe("color_per_state", true);

        // Read channel assignments (page 1 - may not be configured yet)
        var channels = read_channel_assignments_safe();
        ch_clk = channels.ch_clk;
        ch_data = channels.ch_data;

        // Determine output channel (draw on LSB channel)
        ch_out = bit_order == 0 ? ch_data[num_bits - 1] : ch_data[0];

        // Read state names (page 2 - may not be configured yet)
        var num_states = 1 << num_bits;
        state_names = [];
        for (var i = 0; i < num_states; i++) {
            var name = get_gui_value_safe("state_name_" + i, "STATE_" + i);
            state_names.push(name ? name : "STATE_" + i);
        }

        // Generate per-state colors
        state_colors = generate_state_colors(num_states);

        // Initialize fast iterators for data channels
        init_fast_iterators();

        if (ignore_clock) {
            // Clockless mode init
            clockless_buffer_samples = Math.max(1, Math.round(transition_buffer * sampling_rate));

            // Consume the sample-0 API initial-state markers so that
            // data_trs_value[] holds the TRUE initial levels and
            // data_trs[] points to the first real transition.
            for (var i = 0; i < ch_data.length; i++) {
                data_trs_value[i] = data_trs[i].value; // correct the 1-trs.value inversion
                if (ScanaStudio.trs_is_not_last(ch_data[i])) {
                    data_trs[i] = ScanaStudio.trs_get_next(ch_data[i]);
                } else {
                    data_trs_done[i] = true;
                }
            }

            clockless_prev_state = assemble_parallel_value();
            clockless_prev_stable_sample = 0;
        } else {
            // Clock mode: reset clock iterator
            ScanaStudio.trs_reset(ch_clk);
            clk_prev_active_sample = -1;
            clk_prev_state_value = -1;
        }
    }

    if (ignore_clock) {
        // Clockless decode loop (incremental - processes available data then returns)
        var n = ch_data.length;

        // Re-check done flags: streaming may have added more data since last call
        for (var i = 0; i < n; i++) {
            if (data_trs_done[i] && ScanaStudio.trs_is_not_last(ch_data[i])) {
                data_trs[i] = ScanaStudio.trs_get_next(ch_data[i]);
                data_trs_done[i] = false;
            }
        }

        while (!ScanaStudio.abort_is_requested()) {
            // Find the earliest upcoming transition across all channels
            var earliest_sample = -1;
            var all_done = true;

            for (var i = 0; i < n; i++) {
                if (!data_trs_done[i]) {
                    all_done = false;
                    if (earliest_sample < 0 || data_trs[i].sample_index < earliest_sample) {
                        earliest_sample = data_trs[i].sample_index;
                    }
                }
            }

            if (all_done || earliest_sample < 0) {
                break; // No more transitions available yet - will resume on next call
            }

            // An edge was found at earliest_sample. Start the debounce sliding window.
            var settle_deadline = earliest_sample + clockless_buffer_samples;

            // Advance all channels past the earliest edge, and keep extending
            // the deadline if more edges fall within the buffer window.
            var progress = true;
            while (progress && !ScanaStudio.abort_is_requested()) {
                progress = false;
                for (var i = 0; i < n; i++) {
                    while (!data_trs_done[i] && data_trs[i].sample_index <= settle_deadline) {
                        data_trs_value[i] = data_trs[i].value;
                        var edge_sample = data_trs[i].sample_index;

                        var new_deadline = edge_sample + clockless_buffer_samples;
                        if (new_deadline > settle_deadline) {
                            settle_deadline = new_deadline;
                            progress = true;
                        }

                        if (ScanaStudio.trs_is_not_last(ch_data[i])) {
                            data_trs[i] = ScanaStudio.trs_get_next(ch_data[i]);
                        } else {
                            data_trs_done[i] = true;
                        }
                    }
                }
            }

            // All channels have settled. Capture the new parallel state.
            var new_state = assemble_parallel_value();

            if (new_state != clockless_prev_state) {
                // Item covers the stable period BEFORE this transition.
                // Gap of one full buffer period is centered on earliest_sample:
                //   item ends at earliest_sample - buffer/2
                //   next item starts at earliest_sample + buffer/2
                var half_buf = Math.round(clockless_buffer_samples / 2);
                var item_start = clockless_prev_stable_sample;
                var item_end = earliest_sample - half_buf;
                if (item_end <= item_start) {
                    item_end = item_start + 1; // guard: minimum 1-sample width
                }

                // Display the PREVIOUS state (the one that was stable during this item's span)
                var display_state = clockless_prev_state;
                var state_name = state_names[display_state] || ("STATE_" + display_state);
                var formatted_value = format_value(display_state, data_format, num_bits);

                ScanaStudio.dec_item_new(ch_out, item_start, item_end);
                ScanaStudio.dec_item_add_content(state_name + " [" + formatted_value + "]");
                ScanaStudio.dec_item_add_content(state_name);
                ScanaStudio.dec_item_add_content(formatted_value);
                ScanaStudio.dec_item_add_content(display_state.toString());
                ScanaStudio.dec_item_end();

                var pkt_title_color, pkt_content_color;
                if (color_per_state && state_colors.length > display_state) {
                    pkt_title_color = state_colors[display_state].title;
                    pkt_content_color = state_colors[display_state].content;
                } else {
                    pkt_title_color = ScanaStudio.PacketColors.Data.Title;
                    pkt_content_color = ScanaStudio.PacketColors.Data.Content;
                }

                ScanaStudio.packet_view_add_packet(
                    true,
                    ch_out,
                    item_start,
                    item_end,
                    state_name,
                    formatted_value,
                    pkt_title_color,
                    pkt_content_color
                );

                if (num_bits <= 8) {
                    ScanaStudio.hex_view_add_byte(ch_out, item_start, item_end, display_state);
                }

                clockless_prev_state = new_state;
                clockless_prev_stable_sample = earliest_sample + half_buf;
            }
        }
    } else {
        // Clock-based decode loop (incremental)
        // Each decoder item is centered on its active clock edge.
        // We defer emission by one edge so we can compute the half-period.
        while (ScanaStudio.trs_is_not_last(ch_clk) && !ScanaStudio.abort_is_requested()) {
            var trs = ScanaStudio.trs_get_next(ch_clk);

            if (check_edge(trs.value)) {
                var state_value = capture_parallel_data_fast(trs.sample_index);

                // Emit the PREVIOUS state's decoder item, centered on its edge
                if (clk_prev_active_sample >= 0) {
                    var half = Math.floor((trs.sample_index - clk_prev_active_sample) / 2);
                    var item_start = Math.max(0, clk_prev_active_sample - half);
                    var item_end = clk_prev_active_sample + half;

                    var prev_name = state_names[clk_prev_state_value] || ("STATE_" + clk_prev_state_value);
                    var prev_formatted = format_value(clk_prev_state_value, data_format, num_bits);

                    ScanaStudio.dec_item_new(ch_out, item_start, item_end);
                    ScanaStudio.dec_item_add_content(prev_name + " [" + prev_formatted + "]");
                    ScanaStudio.dec_item_add_content(prev_name);
                    ScanaStudio.dec_item_add_content(prev_formatted);
                    ScanaStudio.dec_item_add_content(clk_prev_state_value.toString());
                    ScanaStudio.dec_item_add_sample_point(clk_prev_active_sample, "P");
                    ScanaStudio.dec_item_end();

                    var pkt_title_color, pkt_content_color;
                    if (color_per_state && state_colors.length > clk_prev_state_value) {
                        pkt_title_color = state_colors[clk_prev_state_value].title;
                        pkt_content_color = state_colors[clk_prev_state_value].content;
                    } else {
                        pkt_title_color = ScanaStudio.PacketColors.Data.Title;
                        pkt_content_color = ScanaStudio.PacketColors.Data.Content;
                    }

                    ScanaStudio.packet_view_add_packet(
                        true,
                        ch_out,
                        item_start,
                        item_end,
                        prev_name,
                        prev_formatted,
                        pkt_title_color,
                        pkt_content_color
                    );

                    if (num_bits <= 8) {
                        ScanaStudio.hex_view_add_byte(ch_out, item_start, item_end, clk_prev_state_value);
                    }
                }

                clk_prev_active_sample = trs.sample_index;
                clk_prev_state_value = state_value;
            }
        }
    }
}

/**
 * Assemble the current parallel value from data_trs_value[] without advancing iterators.
 * Used by clockless decoding after all channels have settled.
 */
function assemble_parallel_value() {
    var value = 0;
    var n = ch_data.length;
    for (var i = 0; i < n; i++) {
        var bit = data_trs_value[i];
        if (bit_order == 1) {
            value |= (bit << i);
        } else {
            value |= (bit << (n - 1 - i));
        }
    }
    return value;
}

//Demo signal generation
function on_build_demo_signals() {
    var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
    var sample_rate = ScanaStudio.builder_get_sample_rate();

    // Read configuration from GUI (with safe defaults for demo mode)
    num_bits = get_gui_value_safe("num_bits", 3) + 1; // Default: 4 bits
    bit_order = get_gui_value_safe("bit_order", 0); // MSB first
    var clock_mode = get_gui_value_safe("clock_mode", 0);
    ignore_clock = (clock_mode == 1);
    clk_edge = ignore_clock ? EDGE_RISING : get_gui_value_safe("clk_edge", EDGE_RISING);

    // Read channel assignments (with safe defaults)
    var channels = read_channel_assignments_safe();
    ch_clk = channels.ch_clk;
    ch_data = channels.ch_data;

    // Helper function to get bit value respecting bit order
    function get_bit_value(state_value, bit_index) {
        if (bit_order == 0) {
            // MSB first: ch_data[0] = MSB
            return (state_value >> (num_bits - 1 - bit_index)) & 1;
        } else {
            // LSB first: ch_data[0] = LSB
            return (state_value >> bit_index) & 1;
        }
    }

    var num_states = 1 << num_bits;

    if (ignore_clock) {
        // Clockless demo: generate data channels with state changes separated by idle periods
        var transition_buf = get_gui_value_safe("transition_buffer", 1e-6);
        var state_hold_samples = Math.max(10, Math.floor(sample_rate * transition_buf * 10)); // Hold each state for 10x buffer
        var max_cycles = Math.floor(samples_to_build / state_hold_samples);

        // Add initial silence on data channels
        for (var b = 0; b < num_bits; b++) {
            ScanaStudio.builder_add_samples(ch_data[b], 0, state_hold_samples);
        }

        var current_state = Math.floor(Math.random() * num_states);
        var cycle = 0;

        while (cycle < max_cycles && !ScanaStudio.abort_is_requested()) {
            // Hold current state
            for (var b = 0; b < num_bits; b++) {
                var bit_value = get_bit_value(current_state, b);
                ScanaStudio.builder_add_samples(ch_data[b], bit_value, state_hold_samples);
            }

            // Pick a different next state
            var next_state;
            do {
                next_state = Math.floor(Math.random() * num_states);
            } while (next_state == current_state && num_states > 1);
            current_state = next_state;
            cycle++;
        }
    } else {
        // Clock-based demo
        var clock_freq = 100000; // 100 kHz
        var samples_per_half_clock = Math.floor(sample_rate / (clock_freq * 2));

        if (samples_per_half_clock < 1) {
            samples_per_half_clock = 1;
        }

        var max_cycles = Math.floor(samples_to_build / (samples_per_half_clock * 2));

        // Collect all unique channels
        var all_channels = [ch_clk];
        for (var i = 0; i < ch_data.length; i++) {
            if (all_channels.indexOf(ch_data[i]) < 0) {
                all_channels.push(ch_data[i]);
            }
        }

        // Add initial silence
        for (var c = 0; c < all_channels.length; c++) {
            ScanaStudio.builder_add_samples(all_channels[c], 0, samples_per_half_clock * 2);
        }

        // Generate clock and data - random state transitions
        var current_state = Math.floor(Math.random() * num_states);
        var cycle = 0;

        while (cycle < max_cycles && !ScanaStudio.abort_is_requested()) {
            // Clock low phase - update data
            ScanaStudio.builder_add_samples(ch_clk, 0, samples_per_half_clock);
            for (var b = 0; b < num_bits; b++) {
                var bit_value = get_bit_value(current_state, b);
                ScanaStudio.builder_add_samples(ch_data[b], bit_value, samples_per_half_clock);
            }

            // Clock high phase - data stable (sampling happens here for rising edge)
            ScanaStudio.builder_add_samples(ch_clk, 1, samples_per_half_clock);
            for (var b = 0; b < num_bits; b++) {
                var bit_value = get_bit_value(current_state, b);
                ScanaStudio.builder_add_samples(ch_data[b], bit_value, samples_per_half_clock);
            }

            // Random next state
            current_state = Math.floor(Math.random() * num_states);
            cycle++;
        }
    }
}

// String padding helper
String.prototype.lpad = function (padString, length) {
    var str = this;
    while (str.length < length) {
        str = padString + str;
    }
    return str;
};
