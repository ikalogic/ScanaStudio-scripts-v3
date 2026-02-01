/* Protocol meta info:
<NAME> ADC </NAME>
<DESCRIPTION>
Parallel ADC decoder with single or dual channel support. 
Decodes parallel ADC data lines sampled on clock edges with optional 
Virtual Analog Channel (VAC) display for waveform visualization.
</DESCRIPTION>
<VERSION> 0.1 </VERSION>
<AUTHOR_NAME> Ibrahim KAMAL </AUTHOR_NAME>
<AUTHOR_URL> i.kamal@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright Ibrahim KAMAL </COPYRIGHT>
<LICENSE> This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.1: Initial release.
</RELEASE_NOTES>
*/

//Global variables
var num_channels;
var num_bits;
var bit_order;
var data_format;
var clk_edge;
var signed_data_1, signed_data_2;
var shared_clock;
var vac_enable_1, vac_enable_2;
var vref;

var ch_out_1, ch_out_2;
var draw_on_1, draw_on_2; // 0=LSB, 1=MSB
var ch_clk_1, ch_clk_2;
var ch1_data = [];
var ch2_data = [];

var sampling_rate;
var trs_clk_1, trs_clk_2;
var trs_shared; // Current transition for shared clock mode
var trs1, trs2; // Current transitions for separate clock mode
var clk1_done, clk2_done; // Track if we've reached end of each clock

// Fast iterator state for ADC1 data channels
var ch1_trs = [];       // Current transition for each data channel
var ch1_trs_value = []; // Current logic value (before next transition) for each channel
var ch1_trs_done = [];  // Whether iterator has reached end for each channel

// Fast iterator state for ADC2 data channels
var ch2_trs = [];       // Current transition for each data channel
var ch2_trs_value = []; // Current logic value (before next transition) for each channel
var ch2_trs_done = [];  // Whether iterator has reached end for each channel

//Constants
var EDGE_RISING = 0;
var EDGE_FALLING = 1;
var EDGE_BOTH = 2;

function on_get_n_pages_gui_decoder() {
    return 2;
}

//Decoder GUI
function on_draw_gui_decoder(page_number) {
    switch (page_number) {
        case 0:
            // Step 1: ADC Configuration
            ScanaStudio.gui_add_info_label("Step 1: ADC Configuration", page_number);
            
            // Number of channels
            ScanaStudio.gui_add_combo_box("num_channels", "Number of ADC channels", page_number);
            ScanaStudio.gui_add_item_to_combo_box("1 channel (Single ADC)", true);
            ScanaStudio.gui_add_item_to_combo_box("2 channels (Dual ADC)", false);
            
            // Number of bits
            ScanaStudio.gui_add_combo_box("num_bits", "ADC Resolution (bits)", page_number);
            for (var i = 8; i <= 16; i++) {
                ScanaStudio.gui_add_item_to_combo_box(i.toString() + " bits", (i == 12));
            }
            
            // Bit order
            ScanaStudio.gui_add_combo_box("bit_order", "Bit order", page_number);
            ScanaStudio.gui_add_item_to_combo_box("MSB first", true);
            ScanaStudio.gui_add_item_to_combo_box("LSB first", false);
            
            // Data format
            ScanaStudio.gui_add_combo_box("data_format", "Data format", page_number);
            ScanaStudio.gui_add_item_to_combo_box("Decimal", true);
            ScanaStudio.gui_add_item_to_combo_box("Hexadecimal", false);
            ScanaStudio.gui_add_item_to_combo_box("Binary", false);
            
            ScanaStudio.gui_add_separator("", page_number);
            
            // Clock edge
            ScanaStudio.gui_add_combo_box("clk_edge", "Sample data on", page_number);
            ScanaStudio.gui_add_item_to_combo_box("Rising edge", true);
            ScanaStudio.gui_add_item_to_combo_box("Falling edge", false);
            ScanaStudio.gui_add_item_to_combo_box("Both edges (DDR)", false);
            
            // Shared clock (for dual channel mode)
            ScanaStudio.gui_add_check_box("shared_clock", "Use same clock for both channels", true, page_number);
            
            ScanaStudio.gui_add_separator("", page_number);
            
            // VAC options
            ScanaStudio.gui_add_check_box("vac_enable_1", "Enable Virtual Analog Channel for ADC 1", true, page_number);
            ScanaStudio.gui_add_check_box("vac_enable_2", "Enable Virtual Analog Channel for ADC 2", true, page_number);
            
            // Reference voltage
            ScanaStudio.gui_add_engineering_form_input_box("vref", "Reference voltage (Full scale value)", 0.1, 10, 3.3, "V", page_number);
            
            break;

        case 1:
            // Step 2: Channel Assignment
            ScanaStudio.gui_add_info_label("Step 2: Channel Assignment", page_number);
            
            // Get configuration from page 0
            num_channels = ScanaStudio.gui_get_value("num_channels") + 1; // 0->1, 1->2
            num_bits = ScanaStudio.gui_get_value("num_bits") + 8; // 0->8, 1->9, etc.
            shared_clock = ScanaStudio.gui_get_value("shared_clock");
            
            // Clock configuration tab
            ScanaStudio.gui_add_new_tab("Clock", true);
            if (num_channels == 2 && !shared_clock) {
                ScanaStudio.gui_add_ch_selector("ch_clk_1", "Clock channel (ADC 1)", "CLK1", 0, page_number);
                ScanaStudio.gui_add_ch_selector("ch_clk_2", "Clock channel (ADC 2)", "CLK2", 0, page_number);
            } else {
                ScanaStudio.gui_add_ch_selector("ch_clk_1", "Clock channel", "CLK", 0, page_number);
            }
            ScanaStudio.gui_end_tab();
            
            // ADC 1 configuration tab
            ScanaStudio.gui_add_new_tab("ADC 1", false);
            ScanaStudio.gui_add_combo_box("draw_on_1", "Draw decoded data on", page_number);
            ScanaStudio.gui_add_item_to_combo_box("LSB channel", true);
            ScanaStudio.gui_add_item_to_combo_box("MSB channel", false);
            ScanaStudio.gui_add_check_box("signed_data_1", "Signed data (two's complement)", false, page_number);
            for (var i = 0; i < num_bits; i++) {
                ScanaStudio.gui_add_ch_selector("ch1_d" + i, 
                    "Data bit " + i, 
                    "D" + i, 
                    Math.min(i + 1, ScanaStudio.get_device_channels_count() - 1), 
                    page_number);
            }
            ScanaStudio.gui_end_tab();
            
            if (num_channels == 2) {
                ScanaStudio.gui_add_new_tab("ADC 2", false);
                ScanaStudio.gui_add_combo_box("draw_on_2", "Draw decoded data on", page_number);
                ScanaStudio.gui_add_item_to_combo_box("LSB channel", true);
                ScanaStudio.gui_add_item_to_combo_box("MSB channel", false);
                ScanaStudio.gui_add_check_box("signed_data_2", "Signed data (two's complement)", false, page_number);
                for (var i = 0; i < num_bits; i++) {
                    ScanaStudio.gui_add_ch_selector("ch2_d" + i, 
                        "Data bit " + i, 
                        "Q" + i, 
                        Math.min(i + 1 + num_bits, ScanaStudio.get_device_channels_count() - 1), 
                        page_number);
                }
                ScanaStudio.gui_end_tab();
            }
            break;

        default:
            break;
    }
}

//Evaluate decoder GUI
function on_eval_gui_decoder(page_number) {
    num_channels = ScanaStudio.gui_get_value("num_channels") + 1;
    num_bits = ScanaStudio.gui_get_value("num_bits") + 8;
    shared_clock = ScanaStudio.gui_get_value("shared_clock");
    
    // Calculate minimum required channels
    var required_channels = num_bits + 1; // data bits + clock for ADC1
    if (num_channels == 2) {
        required_channels += num_bits; // data bits for ADC2
        if (!shared_clock) {
            required_channels += 1; // separate clock for ADC2
        }
    }
    
    if (ScanaStudio.get_device_channels_count() < required_channels) {
        return "This configuration requires at least " + required_channels + " channels. " +
               "Your device only has " + ScanaStudio.get_device_channels_count() + " channels.";
    }
    
    // Validate channel uniqueness only on page 1 (where channel selectors are)
    if (page_number != 1) {
        return ""; // Skip channel validation on page 0
    }
    
    var channel_usage = {}; // Maps channel number to description of its usage
    
    // Helper function to check and register channel usage
    function check_channel(ch, description) {
        if (ch === undefined || ch < 0) {
            return null; // Skip undefined channels
        }
        if (channel_usage[ch] !== undefined) {
            return "Channel " + ch + " is assigned to both '" + channel_usage[ch] + "' and '" + description + "'. Each channel can only be used once.";
        }
        channel_usage[ch] = description;
        return null;
    }
    
    // Check clock channel(s)
    var ch_clk_1_val = ScanaStudio.gui_get_value("ch_clk_1");
    var err = check_channel(ch_clk_1_val, "Clock 1");
    if (err) return err;
    
    if (num_channels == 2 && !shared_clock) {
        var ch_clk_2_val = ScanaStudio.gui_get_value("ch_clk_2");
        err = check_channel(ch_clk_2_val, "Clock 2");
        if (err) return err;
    }
    
    // Check ADC1 data channels
    for (var i = 0; i < num_bits; i++) {
        var ch = ScanaStudio.gui_get_value("ch1_d" + i);
        err = check_channel(ch, "ADC1 data bit " + i);
        if (err) return err;
    }
    
    // Check ADC2 channels if dual mode
    if (num_channels == 2) {
        
        for (var i = 0; i < num_bits; i++) {
            var ch = ScanaStudio.gui_get_value("ch2_d" + i);
            err = check_channel(ch, "ADC2 data bit " + i);
            if (err) return err;
        }
    }
    
    return ""; // All good
}

function on_decode_signals(resume) {
    if (!resume) {
        // Initialization
        sampling_rate = ScanaStudio.get_capture_sample_rate();
        
        // Read GUI values
        num_channels = ScanaStudio.gui_get_value("num_channels") + 1;
        num_bits = ScanaStudio.gui_get_value("num_bits") + 8;
        bit_order = ScanaStudio.gui_get_value("bit_order"); // 0=MSB first, 1=LSB first
        data_format = ScanaStudio.gui_get_value("data_format"); // 0=Dec, 1=Hex, 2=Bin
        clk_edge = ScanaStudio.gui_get_value("clk_edge"); // 0=Rising, 1=Falling, 2=Both
        signed_data_1 = ScanaStudio.gui_get_value("signed_data_1");
        shared_clock = ScanaStudio.gui_get_value("shared_clock");
        vac_enable_1 = ScanaStudio.gui_get_value("vac_enable_1");
        vac_enable_2 = ScanaStudio.gui_get_value("vac_enable_2");
        vref = ScanaStudio.gui_get_value("vref");
        
        // Read channel assignments
        draw_on_1 = ScanaStudio.gui_get_value("draw_on_1"); // 0=LSB, 1=MSB
        ch_clk_1 = ScanaStudio.gui_get_value("ch_clk_1");
        
        ch1_data = [];
        for (var i = 0; i < num_bits; i++) {
            ch1_data.push(ScanaStudio.gui_get_value("ch1_d" + i));
        }
        
        // Determine output channel based on draw_on choice
        // bit_order: 0=MSB first, 1=LSB first
        // draw_on: 0=LSB, 1=MSB
        if (draw_on_1 == 0) {
            // Draw on LSB channel
            ch_out_1 = bit_order == 0 ? ch1_data[num_bits - 1] : ch1_data[0];
        } else {
            // Draw on MSB channel
            ch_out_1 = bit_order == 0 ? ch1_data[0] : ch1_data[num_bits - 1];
        }
        
        if (num_channels == 2) {
            draw_on_2 = ScanaStudio.gui_get_value("draw_on_2"); // 0=LSB, 1=MSB
            signed_data_2 = ScanaStudio.gui_get_value("signed_data_2");
            if (shared_clock) {
                ch_clk_2 = ch_clk_1;
            } else {
                ch_clk_2 = ScanaStudio.gui_get_value("ch_clk_2");
            }
            
            ch2_data = [];
            for (var i = 0; i < num_bits; i++) {
                ch2_data.push(ScanaStudio.gui_get_value("ch2_d" + i));
            }
            
            // Determine output channel based on draw_on choice
            if (draw_on_2 == 0) {
                // Draw on LSB channel
                ch_out_2 = bit_order == 0 ? ch2_data[num_bits - 1] : ch2_data[0];
            } else {
                // Draw on MSB channel
                ch_out_2 = bit_order == 0 ? ch2_data[0] : ch2_data[num_bits - 1];
            }
        }
        
        // Initialize VAC channels
        if (vac_enable_1) {
            ScanaStudio.vac_create_channel(0, "V", "#118c8c", "ADC1");
            ScanaStudio.vac_set_size(0, 5);
        } else {
            ScanaStudio.vac_remove_channel(0);
        }
        
        if (num_channels == 2 && vac_enable_2) {
            ScanaStudio.vac_create_channel(1, "V", "#8c1188", "ADC2");
            ScanaStudio.vac_set_size(1, 5);
        } else {
            ScanaStudio.vac_remove_channel(1);
        }
        
        // Reset clock iterator
        ScanaStudio.trs_reset(ch_clk_1);
        trs_shared = ScanaStudio.trs_get_next(ch_clk_1);
        
        // Initialize separate clock state variables
        clk1_done = false;
        clk2_done = (num_channels == 1) || shared_clock; // No ADC2 clock to process if single channel or shared clock
        
        if (num_channels == 2 && !shared_clock) {
            ScanaStudio.trs_reset(ch_clk_1);
            ScanaStudio.trs_reset(ch_clk_2);
            trs1 = ScanaStudio.trs_get_next(ch_clk_1);
            trs2 = ScanaStudio.trs_get_next(ch_clk_2);
        }
        
        // Initialize fast iterators for data channels
        init_fast_iterators();
    }
    
    // Decode both ADC channels in parallel
    if (shared_clock || num_channels == 1) {
        // Single clock source - decode both channels together
        decode_adc_shared_clock();
    } else {
        // Separate clocks - need to interleave based on clock transitions
        decode_adc_separate_clocks();
    }
}

function decode_adc_shared_clock() {
    var prev_sample_index = null;
    
    while (ScanaStudio.trs_is_not_last(ch_clk_1) && !ScanaStudio.abort_is_requested()) {
        var trs = ScanaStudio.trs_get_next(ch_clk_1);
        
        // Check if this is the edge we want to sample on
        var should_sample = false;
        if (clk_edge == EDGE_RISING && trs.value == 1) {
            should_sample = true;
        } else if (clk_edge == EDGE_FALLING && trs.value == 0) {
            should_sample = true;
        } else if (clk_edge == EDGE_BOTH) {
            should_sample = true;
        }
        
        if (should_sample) {
            // Calculate centered decoder item bounds
            var bounds = get_decoder_item_bounds(trs.sample_index, prev_sample_index);
            prev_sample_index = trs.sample_index;
            
            // Decode ADC 1
            decode_single_sample(ch_out_1, ch1_data, trs.sample_index, bounds.start, bounds.end, 0, vac_enable_1, "ADC1", signed_data_1);
            
            // Decode ADC 2 if dual channel mode
            if (num_channels == 2) {
                decode_single_sample(ch_out_2, ch2_data, trs.sample_index, bounds.start, bounds.end, 1, vac_enable_2, "ADC2", signed_data_2);
            }
        }
    }
}

function decode_adc_separate_clocks() {
    var prev_sample_index_1 = null;
    var prev_sample_index_2 = null;
    
    while (!ScanaStudio.abort_is_requested()) {
        // Check if we're done with both clocks
        if (clk1_done && clk2_done) {
            break;
        }
        
        // Determine which clock edge comes first
        var process_clk1 = false;
        var process_clk2 = false;
        
        if (clk1_done) {
            process_clk2 = true;
        } else if (clk2_done) {
            process_clk1 = true;
        } else if (trs1.sample_index <= trs2.sample_index) {
            process_clk1 = true;
        } else {
            process_clk2 = true;
        }
        
        // Process clock 1
        if (process_clk1 && !clk1_done) {
            var should_sample = check_edge(trs1.value);
            if (should_sample) {
                var bounds = get_decoder_item_bounds(trs1.sample_index, prev_sample_index_1);
                prev_sample_index_1 = trs1.sample_index;
                decode_single_sample(ch_out_1, ch1_data, trs1.sample_index, bounds.start, bounds.end, 0, vac_enable_1, "ADC1", signed_data_1);
            }
            
            if (ScanaStudio.trs_is_not_last(ch_clk_1)) {
                trs1 = ScanaStudio.trs_get_next(ch_clk_1);
            } else {
                clk1_done = true;
            }
        }
        
        // Process clock 2
        if (process_clk2 && !clk2_done) {
            var should_sample = check_edge(trs2.value);
            if (should_sample) {
                var bounds = get_decoder_item_bounds(trs2.sample_index, prev_sample_index_2);
                prev_sample_index_2 = trs2.sample_index;
                decode_single_sample(ch_out_2, ch2_data, trs2.sample_index, bounds.start, bounds.end, 1, vac_enable_2, "ADC2", signed_data_2);
            }
            
            if (ScanaStudio.trs_is_not_last(ch_clk_2)) {
                trs2 = ScanaStudio.trs_get_next(ch_clk_2);
            } else {
                clk2_done = true;
            }
        }
    }
}

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
 * Calculate centered decoder item bounds based on sampling interval.
 * @param sample_index - Current sampling point
 * @param prev_sample_index - Previous sampling point (null for first sample)
 * @returns Object with start and end sample indices for drawing
 */
function get_decoder_item_bounds(sample_index, prev_sample_index) {
    var half_width;
    if (prev_sample_index !== null) {
        var interval = sample_index - prev_sample_index;
        half_width = Math.floor(interval * 0.45); // 90% total width, centered
    } else {
        half_width = 1; // First sample: minimal width
    }
    
    var start = sample_index - half_width;
    var end = sample_index + half_width;
    
    // Boundary check: ensure start is never negative
    if (start < 0) {
        start = 0;
    }
    
    return { start: start, end: end };
}

function decode_single_sample(out_ch, data_channels, sample_index, draw_start, draw_end, vac_index, vac_enabled, channel_name, is_signed) {
    // Determine which iterator arrays to use
    var trs_array, value_array, done_array;
    if (channel_name == "ADC1") {
        trs_array = ch1_trs;
        value_array = ch1_trs_value;
        done_array = ch1_trs_done;
    } else {
        trs_array = ch2_trs;
        value_array = ch2_trs_value;
        done_array = ch2_trs_done;
    }
    
    // Capture data using fast forward-only iterators
    var adc_value = capture_parallel_data_fast(data_channels, trs_array, value_array, done_array, sample_index, bit_order);
    
    // Convert to signed if needed
    if (is_signed) {
        adc_value = convert_to_signed(adc_value, num_bits);
    }
    
    // Calculate voltage
    var max_value = is_signed ? (1 << (num_bits - 1)) : (1 << num_bits);
    var voltage;
    if (is_signed) {
        voltage = (adc_value / max_value) * vref;
    } else {
        voltage = (adc_value / (max_value - 1)) * vref;
    }
    
    // Create decoder item (use draw_start/draw_end for centered visual bounds)
    ScanaStudio.dec_item_new(out_ch, draw_start, draw_end);
    
    var formatted_value = format_value(adc_value, data_format, num_bits);
    var voltage_str = voltage.toFixed(3) + "V";
    
    ScanaStudio.dec_item_add_content(channel_name + ": " + formatted_value + " (" + voltage_str + ")");
    ScanaStudio.dec_item_add_content(formatted_value + " (" + voltage_str + ")");
    ScanaStudio.dec_item_add_content(formatted_value);
    ScanaStudio.dec_item_add_content(adc_value.toString());
    
    ScanaStudio.dec_item_end();
    
    // Add to VAC
    if (vac_enabled) {
        ScanaStudio.vac_append_sample(vac_index, sample_index, voltage);
    }
}

/**
 * Initialize fast forward-only iterators for all data channels.
 * This must be called once at the start of decoding.
 * 
 * For each channel, we get the first transition and derive the initial
 * logic value (before that transition) by inverting the transition's target value.
 * Example: if first transition is to '1' at sample 100, then from sample 0-99
 * the value was '0'.
 */
function init_fast_iterators() {
    // Initialize ADC1 data channel iterators
    ch1_trs = [];
    ch1_trs_value = [];
    ch1_trs_done = [];
    
    for (var i = 0; i < ch1_data.length; i++) {
        ScanaStudio.trs_reset(ch1_data[i]);
        var trs = ScanaStudio.trs_get_next(ch1_data[i]);
        ch1_trs.push(trs);
        // Initial value is opposite of first transition's target
        // (if transitioning TO 1, it was 0 before; if TO 0, it was 1 before)
        ch1_trs_value.push(1 - trs.value);
        ch1_trs_done.push(false);
    }
    
    // Initialize ADC2 data channel iterators if dual channel mode
    ch2_trs = [];
    ch2_trs_value = [];
    ch2_trs_done = [];
    
    if (num_channels == 2) {
        for (var i = 0; i < ch2_data.length; i++) {
            ScanaStudio.trs_reset(ch2_data[i]);
            var trs = ScanaStudio.trs_get_next(ch2_data[i]);
            ch2_trs.push(trs);
            ch2_trs_value.push(1 - trs.value);
            ch2_trs_done.push(false);
        }
    }
}

/**
 * Capture parallel data using fast forward-only iterators.
 * 
 * This function advances each channel's iterator forward until it passes
 * the target sample_index, updating the tracked logic value as it goes.
 * This is much faster than trs_get_before() which does an internal search
 * each time it's called.
 * 
 * @param channels - Array of channel numbers for data bits
 * @param trs_array - Array of current transitions (one per channel)
 * @param value_array - Array of current logic values (one per channel)
 * @param done_array - Array of booleans indicating iterator exhaustion
 * @param sample_index - The sample point at which to capture data
 * @param lsb_first - If true, channels[0] is LSB; if false, channels[0] is MSB
 * @returns The captured parallel value
 */
function capture_parallel_data_fast(channels, trs_array, value_array, done_array, sample_index, lsb_first) {
    var value = 0;
    var n = channels.length;
    
    for (var i = 0; i < n; i++) {
        // Advance iterator forward while current transition is at or before sample_index
        // When we pass a transition, we update the value to what it became after that transition
        while (!done_array[i] && trs_array[i].sample_index <= sample_index) {
            // We've passed this transition, so update value to the transition's target
            value_array[i] = trs_array[i].value;
            
            // Try to get the next transition
            if (ScanaStudio.trs_is_not_last(channels[i])) {
                trs_array[i] = ScanaStudio.trs_get_next(channels[i]);
            } else {
                // No more transitions - mark as done and keep last value
                done_array[i] = true;
            }
        }
        
        // Now value_array[i] contains the logic level at sample_index
        var bit = value_array[i];
        
        if (lsb_first) {
            // LSB first: bit 0 is in channels[0]
            value |= (bit << i);
        } else {
            // MSB first: bit 0 is in channels[n-1]
            value |= (bit << (n - 1 - i));
        }
    }
    
    return value;
}

function convert_to_signed(value, bits) {
    var sign_bit = 1 << (bits - 1);
    if (value & sign_bit) {
        // Negative number - extend sign
        value = value - (1 << bits);
    }
    return value;
}

function format_value(value, format, bits) {
    switch (format) {
        case 0: // Decimal
            return value.toString(10);
        case 1: // Hex
            var hex_digits = Math.ceil(bits / 4);
            if (value < 0) {
                // Handle negative numbers
                value = (1 << bits) + value;
            }
            return "0x" + value.toString(16).toUpperCase().lpad("0", hex_digits);
        case 2: // Binary
            if (value < 0) {
                value = (1 << bits) + value;
            }
            return "0b" + value.toString(2).lpad("0", bits);
        default:
            return value.toString();
    }
}

function format_time(time_value) {
    return ScanaStudio.engineering_notation(time_value, 6) + "s";
}

//Demo signal generation
function on_build_demo_signals() {
    var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
    var sample_rate = ScanaStudio.builder_get_sample_rate();
    
    // Read all configuration from GUI (page 0)
    num_channels = ScanaStudio.gui_get_value("num_channels") + 1;
    num_bits = ScanaStudio.gui_get_value("num_bits") + 8;
    bit_order = ScanaStudio.gui_get_value("bit_order"); // 0=MSB first, 1=LSB first
    clk_edge = ScanaStudio.gui_get_value("clk_edge");
    shared_clock = ScanaStudio.gui_get_value("shared_clock");
    
    // Read channel assignments from GUI (page 1)
    ch_clk_1 = ScanaStudio.gui_get_value("ch_clk_1");
    ch1_data = [];
    for (var i = 0; i < num_bits; i++) {
        ch1_data.push(ScanaStudio.gui_get_value("ch1_d" + i));
    }
    
    if (num_channels == 2) {
        if (shared_clock) {
            ch_clk_2 = ch_clk_1;
        } else {
            ch_clk_2 = ScanaStudio.gui_get_value("ch_clk_2");
        }
        ch2_data = [];
        for (var i = 0; i < num_bits; i++) {
            ch2_data.push(ScanaStudio.gui_get_value("ch2_d" + i));
        }
    }
    
    // Demo parameters
    var clock_freq = 100000; // 100 kHz
    var num_cycles = 5000;
    var samples_per_half_clock = Math.floor(sample_rate / (clock_freq * 2));
    
    if (samples_per_half_clock < 1) {
        samples_per_half_clock = 1;
    }
    
    // Sine wave frequency (number of complete cycles in the demo)
    var sine_cycles = 10; // 10 complete sine waves in 5000 samples
    var max_adc_value = (1 << num_bits) - 1;
    var mid_value = max_adc_value / 2;
    
    // Initialize all channels to 0
    var all_channels = [ch_clk_1];
    for (var i = 0; i < ch1_data.length; i++) {
        if (all_channels.indexOf(ch1_data[i]) < 0) {
            all_channels.push(ch1_data[i]);
        }
    }
    if (num_channels == 2) {
        if (all_channels.indexOf(ch_clk_2) < 0) {
            all_channels.push(ch_clk_2);
        }
        for (var i = 0; i < ch2_data.length; i++) {
            if (all_channels.indexOf(ch2_data[i]) < 0) {
                all_channels.push(ch2_data[i]);
            }
        }
    }
    
    // Add initial silence
    for (var c = 0; c < all_channels.length; c++) {
        ScanaStudio.builder_add_samples(all_channels[c], 0, samples_per_half_clock * 2);
    }
    
    // Helper function to get bit value respecting bit order
    // bit_order: 0=MSB first, 1=LSB first
    // b is the channel index (0 to num_bits-1)
    function get_bit_value(adc_value, b) {
        if (bit_order == 0) {
            // MSB first: channel 0 = MSB, channel (num_bits-1) = LSB
            return (adc_value >> (num_bits - 1 - b)) & 1;
        } else {
            // LSB first: channel 0 = LSB, channel (num_bits-1) = MSB
            return (adc_value >> b) & 1;
        }
    }
    
    // Generate clock and data
    for (var cycle = 0; cycle < num_cycles; cycle++) {
        if (ScanaStudio.abort_is_requested()) {
            break;
        }
        
        // Calculate sine wave value for this sample
        var angle1 = (2 * Math.PI * sine_cycles * cycle) / num_cycles;
        var adc1_value = Math.round(mid_value + mid_value * Math.sin(angle1));
        adc1_value = Math.max(0, Math.min(max_adc_value, adc1_value));
        
        var adc2_value = 0;
        if (num_channels == 2) {
            // Cosine wave for Q channel (90 degree phase shift)
            var angle2 = angle1 + Math.PI / 2;
            adc2_value = Math.round(mid_value + mid_value * Math.sin(angle2));
            adc2_value = Math.max(0, Math.min(max_adc_value, adc2_value));
        }
        
        // Clock low phase - set data
        ScanaStudio.builder_add_samples(ch_clk_1, 0, samples_per_half_clock);
        for (var b = 0; b < num_bits; b++) {
            var bit_value = get_bit_value(adc1_value, b);
            ScanaStudio.builder_add_samples(ch1_data[b], bit_value, samples_per_half_clock);
        }
        
        if (num_channels == 2) {
            if (!shared_clock) {
                ScanaStudio.builder_add_samples(ch_clk_2, 0, samples_per_half_clock);
            }
            for (var b = 0; b < num_bits; b++) {
                var bit_value = get_bit_value(adc2_value, b);
                ScanaStudio.builder_add_samples(ch2_data[b], bit_value, samples_per_half_clock);
            }
        }
        
        // Clock high phase - data stable
        ScanaStudio.builder_add_samples(ch_clk_1, 1, samples_per_half_clock);
        for (var b = 0; b < num_bits; b++) {
            var bit_value = get_bit_value(adc1_value, b);
            ScanaStudio.builder_add_samples(ch1_data[b], bit_value, samples_per_half_clock);
        }
        
        if (num_channels == 2) {
            if (!shared_clock) {
                ScanaStudio.builder_add_samples(ch_clk_2, 1, samples_per_half_clock);
            }
            for (var b = 0; b < num_bits; b++) {
                var bit_value = get_bit_value(adc2_value, b);
                ScanaStudio.builder_add_samples(ch2_data[b], bit_value, samples_per_half_clock);
            }
        }
    }
}

// String padding helper
String.prototype.lpad = function(padString, length) {
    var str = this;
    while (str.length < length) {
        str = padString + str;
    }
    return str;
};
