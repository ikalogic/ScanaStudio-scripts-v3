/* Protocol meta info:
<NAME> MDIO </NAME>
<DESCRIPTION>
IEEE 802.3 MDIO (Management Data Input/Output) decoder with Clause 22 and Clause 45 support.
(Clause 45 is untested, please report any issues you may find)
</DESCRIPTION>
<VERSION> 1.0 </VERSION>
<AUTHOR_NAME> Ibrahim KAMAL </AUTHOR_NAME>
<AUTHOR_URL> contact@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright IKALOGIC SAS </COPYRIGHT>
<LICENSE> This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
v1.0: Initial release with Clause 22 decoding, Packet View, demo builder and trigger helper.
</RELEASE_NOTES>
*/

const pktclr = {
    //dark green title
    title: "#006400",
    //lighe blue for preamble
    pre: "#7aaaff",
    control: "#ffca7a", //light yellow
    address: "#f7a325",
    data: "#37d48a",
    err: "#f56038",
    warn: "#f7a325",
};

// -----------------------------------------------------------------------------
// Decoder configuration GUI
// -----------------------------------------------------------------------------

function on_draw_gui_decoder() {
    ScanaStudio.gui_add_ch_selector("ch_mdio", "MDIO data", "MDIO");
    ScanaStudio.gui_add_ch_selector("ch_mdc", "MDC clock", "MDC");

    ScanaStudio.gui_add_combo_box("clause_mode", "Clauses to decode");
    ScanaStudio.gui_add_item_to_combo_box("Auto (Clause 22 and Clause 45)", true);
    ScanaStudio.gui_add_item_to_combo_box("Clause 22 only", false);
    ScanaStudio.gui_add_item_to_combo_box("Clause 45 only", false);

    ScanaStudio.gui_add_combo_box("preamble_requirement", "Preamble handling");
    ScanaStudio.gui_add_item_to_combo_box("Require 32 consecutive 1s", true);
    ScanaStudio.gui_add_item_to_combo_box("Require at least 16 ones", false);
    ScanaStudio.gui_add_item_to_combo_box("Preamble optional", false);

    ScanaStudio.gui_add_check_box("show_preamble", "Display preamble as a decoded item", true);
    ScanaStudio.gui_add_check_box("ta_warning", "Highlight unexpected turnaround patterns", true);
    ScanaStudio.gui_add_check_box("include_crc", "Frames include 16-bit CRC", false);

    ScanaStudio.gui_add_combo_box("data_format", "Data display format");
    ScanaStudio.gui_add_item_to_combo_box("Hexadecimal", true);
    ScanaStudio.gui_add_item_to_combo_box("Unsigned decimal", false);
    ScanaStudio.gui_add_item_to_combo_box("Binary", false);
}

function on_eval_gui_decoder() {
    var mdio_ch = ScanaStudio.gui_get_value("ch_mdio");
    var mdc_ch = ScanaStudio.gui_get_value("ch_mdc");

    if (mdio_ch == mdc_ch) {
        return "Please select two distinct channels for MDIO and MDC.";
    }

    ScanaStudio.set_script_instance_name("MDIO on CH" + (mdio_ch + 1) + " / CH" + (mdc_ch + 1));
    return "";
}

// -----------------------------------------------------------------------------
// Trigger GUI
// -----------------------------------------------------------------------------

function on_draw_gui_trigger() {
    ScanaStudio.gui_add_info_label("Trigger on MDIO frame boundaries or address fields.");

    ScanaStudio.gui_add_combo_box("trig_frame_type", "Trigger on");
    ScanaStudio.gui_add_item_to_combo_box("Clause 22 - Any frame", true);
    ScanaStudio.gui_add_item_to_combo_box("Clause 22 - Write", false);
    ScanaStudio.gui_add_item_to_combo_box("Clause 22 - Read", false);
    ScanaStudio.gui_add_item_to_combo_box("Clause 45 - Any frame", false);
    ScanaStudio.gui_add_item_to_combo_box("Clause 45 - Address", false);
    ScanaStudio.gui_add_item_to_combo_box("Clause 45 - Write", false);
    ScanaStudio.gui_add_item_to_combo_box("Clause 45 - Read", false);
    ScanaStudio.gui_add_item_to_combo_box("Clause 45 - Read increment", false);

    ScanaStudio.gui_add_check_box("trig_match_phy", "Match PHY address", false);
    ScanaStudio.gui_add_text_input("trig_phy", "PHY address (0-31)", "0x1");

    ScanaStudio.gui_add_check_box("trig_match_devreg", "Match register / device address", false);
    ScanaStudio.gui_add_text_input("trig_reg", "Register or device address (0-31)", "0x0");

    ScanaStudio.gui_add_check_box("trig_match_data", "Match data field", false);
    ScanaStudio.gui_add_text_input("trig_data", "Data value (16-bit)", "0x1234");

    ScanaStudio.gui_add_check_box("trig_include_preamble", "Force 32-bit preamble", true);
}

function on_eval_gui_trigger() {
    try {
        var phy_val = parse_gui_integer(ScanaStudio.gui_get_value("trig_phy"));
        if ((phy_val < 0) || (phy_val > 31)) {
            return "PHY address must be in the 0..31 range.";
        }

        var reg_val = parse_gui_integer(ScanaStudio.gui_get_value("trig_reg"));
        if ((reg_val < 0) || (reg_val > 31)) {
            return "Register/device address must be in the 0..31 range.";
        }

        var data_val = parse_gui_integer(ScanaStudio.gui_get_value("trig_data"));
        if ((data_val < 0) || (data_val > 0xFFFF)) {
            return "Data value must be a 16-bit number.";
        }
    }
    catch (e) {
        return e;
    }

    return "";
}

// -----------------------------------------------------------------------------
// Decoder globals and helpers
// -----------------------------------------------------------------------------

var CLAUSE_AUTO = 0;
var CLAUSE_22 = 1;
var CLAUSE_45 = 2;

var data_format_mode;
var clause_mode;
var required_preamble_bits;
var show_preamble_item;
var warn_ta;
var expect_crc_field;
var ch_mdio;
var ch_mdc;
var sampling_rate;

var mdio_bits_buffer;

function reload_dec_gui_values() {
    ch_mdio = ScanaStudio.gui_get_value("ch_mdio");
    ch_mdc = ScanaStudio.gui_get_value("ch_mdc");
    clause_mode = ScanaStudio.gui_get_value("clause_mode");
    show_preamble_item = ScanaStudio.gui_get_value("show_preamble");
    warn_ta = ScanaStudio.gui_get_value("ta_warning");
    expect_crc_field = ScanaStudio.gui_get_value("include_crc");
    data_format_mode = ScanaStudio.gui_get_value("data_format");

    switch (ScanaStudio.gui_get_value("preamble_requirement")) {
        case 0:
            required_preamble_bits = 32;
            break;
        case 1:
            required_preamble_bits = 16;
            break;
        default:
            required_preamble_bits = 0;
            break;
    }
}

function on_decode_signals(resume) {
    if (!resume) {
        reload_dec_gui_values();
        sampling_rate = ScanaStudio.get_capture_sample_rate();
        mdio_bits_buffer = [];
        ScanaStudio.trs_reset(ch_mdio);
        ScanaStudio.trs_reset(ch_mdc);
    }

    while (ScanaStudio.abort_is_requested() == false) {
        var frame = mdio_fetch_frame();
        if (frame == null) {
            break;
        }
        mdio_render_frame(frame);
    }
}

function mdio_fetch_frame() {
    var start_info = mdio_find_start();
    if (start_info == null) {
        return null;
    }

    var required_bits = 30; // Fields after start bits
    var bit_infos = start_info.start_bits.slice(0);

    while (bit_infos.length < (2 + required_bits)) {
        var info = mdio_fetch_next_bit();
        if (info == null) {
            return null;
        }
        bit_infos.push(info);
    }

    if (expect_crc_field) {
        var crc_infos = mdio_try_fetch_bits(16);
        if (crc_infos != null) {
            for (var c = 0; c < crc_infos.length; c++) {
                bit_infos.push(crc_infos[c]);
            }
        }
    }

    return mdio_parse_frame(start_info, bit_infos);
}

function mdio_find_start() {
    var prev_info = null;
    var current_run_start = -1;
    var current_run_count = 0;
    var last_run = null;

    while (ScanaStudio.abort_is_requested() == false) {
        var info = mdio_fetch_next_bit();
        if (info == null) {
            return null;
        }

        if (info.bit == 1) {
            if (current_run_count == 0) {
                current_run_start = info.sample_index;
            }
            current_run_count++;
        }
        else {
            if (current_run_count > 0) {
                last_run = {
                    start_sample: current_run_start,
                    end_sample: prev_info.sample_index,
                    count: current_run_count
                };
            }
            current_run_count = 0;
        }

        if (prev_info != null) {
            var start_code = (prev_info.bit << 1) | info.bit;
            var clause_detected = -1;

            if ((start_code === 0x1) && (clause_mode !== CLAUSE_45)) {
                clause_detected = CLAUSE_22;
            }
            else if ((start_code === 0x0) && (clause_mode !== CLAUSE_22)) {
                clause_detected = CLAUSE_45;
            }

            if (clause_detected !== -1) {
                var has_valid_preamble = (required_preamble_bits === 0);
                if ((required_preamble_bits > 0) && (last_run != null) && (last_run.count >= required_preamble_bits)) {
                    has_valid_preamble = true;
                }

                if (has_valid_preamble) {
                    return {
                        clause: clause_detected,
                        preamble: last_run,
                        start_bits: [
                            {
                                bit: prev_info.bit,
                                sample_index: prev_info.sample_index
                            },
                            {
                                bit: info.bit,
                                sample_index: info.sample_index
                            }
                        ]
                    };
                }
            }
        }

        prev_info = info;
    }

    return null;
}

function mdio_fetch_next_bit() {
    if ((mdio_bits_buffer != null) && (mdio_bits_buffer.length > 0)) {
        return mdio_bits_buffer.shift();
    }

    while (ScanaStudio.trs_is_not_last(ch_mdc)) {
        var trs_clk = ScanaStudio.trs_get_next(ch_mdc);
        if (trs_clk == null) {
            return null;
        }

        if (trs_clk.value == 1) {
            var data_transition = ScanaStudio.trs_get_before(ch_mdio, trs_clk.sample_index);
            var bit_val = data_transition ? data_transition.value : 1;
            return {
                bit: bit_val,
                sample_index: trs_clk.sample_index
            };
        }
    }

    return null;
}

function mdio_try_fetch_bits(count) {
    var infos = [];

    for (var i = 0; i < count; i++) {
        var info = mdio_fetch_next_bit();
        if (info == null) {
            mdio_pushback_bits(infos);
            return null;
        }
        infos.push(info);
    }

    return infos;
}

function mdio_pushback_bits(bit_infos) {
    if (!bit_infos || (bit_infos.length === 0)) {
        return;
    }

    if (mdio_bits_buffer == null) {
        mdio_bits_buffer = [];
    }

    for (var i = bit_infos.length - 1; i >= 0; i--) {
        mdio_bits_buffer.unshift(bit_infos[i]);
    }
}

function mdio_parse_frame(start_info, bit_infos) {
    var frame = {
        clause: start_info.clause,
        bit_infos: bit_infos,
        preamble: start_info.preamble,
        has_error: false,
        has_warning: false,
        has_crc: false,
        crc_valid: false,
        crc_expected: 0,
        crc_start_index: -1,
        crc_algorithm: ""
    };

    frame.start_sample = bit_infos[0].sample_index;
    frame.end_sample = bit_infos[bit_infos.length - 1].sample_index;
    frame.margin = mdio_compute_margin(bit_infos);
    frame.full_start = (frame.preamble) ? frame.preamble.start_sample : frame.start_sample;
    frame.full_end = frame.end_sample;

    var bits = [];
    for (var i = 0; i < bit_infos.length; i++) {
        bits.push(bit_infos[i].bit);
    }

    frame.start_bits_value = (bits[0] << 1) | bits[1];

    var index = 2;
    frame.op = mdio_bits_to_int(bits, index, 2);
    index += 2;

    frame.phy = mdio_bits_to_int(bits, index, 5);
    index += 5;

    frame.dev_or_reg = mdio_bits_to_int(bits, index, 5);
    index += 5;

    frame.ta = mdio_bits_to_int(bits, index, 2);
    frame.ta_bits = bits.slice(index, index + 2);
    index += 2;

    frame.data = mdio_bits_to_int(bits, index, 16);
    frame.data_bits = bits.slice(index, index + 16);
    frame.data_start_index = index;
    index += 16;

    if ((bit_infos.length >= (index + 16)) && expect_crc_field) {
        frame.has_crc = true;
        frame.crc_start_index = index;
        frame.crc = mdio_bits_to_int(bits, index, 16);
        frame.crc_bits = bits.slice(index, index + 16);

        var crc_candidates = mdio_crc_calculate_candidates(bits.slice(0, index));
        frame.crc_expected = crc_candidates[0].value;
        frame.crc_algorithm = crc_candidates[0].name;
        frame.crc_valid = false;

        for (var c = 0; c < crc_candidates.length; c++) {
            if (frame.crc === crc_candidates[c].value) {
                frame.crc_valid = true;
                frame.crc_expected = crc_candidates[c].value;
                frame.crc_algorithm = crc_candidates[c].name;
                break;
            }
        }

        if (!frame.crc_valid) {
            frame.has_error = true;
        }
    }

    frame.summary = mdio_build_summary(frame);
    return frame;
}

function mdio_compute_margin(bit_infos) {
    if (bit_infos.length < 2) {
        return 1;
    }

    var min_delta = bit_infos[1].sample_index - bit_infos[0].sample_index;
    for (var i = 2; i < bit_infos.length; i++) {
        var delta = bit_infos[i].sample_index - bit_infos[i - 1].sample_index;
        if (delta < min_delta) {
            min_delta = delta;
        }
    }

    if (min_delta <= 0) {
        return 1;
    }

    return Math.max(1, Math.floor(min_delta / 2));
}

function mdio_bits_to_int(bits, start, length) {
    var value = 0;
    for (var i = 0; i < length; i++) {
        value = (value << 1) | bits[start + i];
    }
    return value;
}

function mdio_bits_to_string(bits_array) {
    var s = "";
    for (var i = 0; i < bits_array.length; i++) {
        s += bits_array[i].toString();
    }
    return s;
}

function mdio_format_value(value, width_bits) {
    switch (data_format_mode) {
        case 1:
            return value.toString(10);
        case 2:
            var width = Math.max(1, width_bits);
            return "b" + mdio_pad_binary(value, width);
        default:
            var digits = Math.ceil(width_bits / 4);
            return "0x" + mdio_pad_hex(value, digits);
    }
}

function mdio_pad_hex(value, digits) {
    var s = value.toString(16).toUpperCase();
    while (s.length < digits) {
        s = "0" + s;
    }
    return s;
}

function mdio_pad_binary(value, width) {
    var s = value.toString(2);
    while (s.length < width) {
        s = "0" + s;
    }
    return s;
}

function mdio_crc_calculate_candidates(bits) {
    var configs = [
        { name: "CRC-16/IBM", polynomial: 0x8005, initial: 0xFFFF },
        { name: "CRC-16/IBM-0", polynomial: 0x8005, initial: 0x0000 },
        { name: "CRC-16/CCITT", polynomial: 0x1021, initial: 0xFFFF },
        { name: "CRC-16/CCITT-0", polynomial: 0x1021, initial: 0x0000 }
    ];

    var results = [];

    for (var i = 0; i < configs.length; i++) {
        results.push({
            name: configs[i].name,
            value: mdio_crc16(bits, configs[i].polynomial, configs[i].initial)
        });
    }

    return results;
}

function mdio_crc16(bits, polynomial, initial) {
    var crc = initial & 0xFFFF;

    for (var i = 0; i < bits.length; i++) {
        var bit = bits[i] & 0x1;
        var msb = (crc >> 15) & 0x1;
        crc = ((crc << 1) & 0xFFFF);
        if ((msb ^ bit) === 1) {
            crc ^= polynomial;
        }
    }

    return crc & 0xFFFF;
}

function mdio_build_summary(frame) {
    var text = "";

    if (frame.clause === CLAUSE_22) {
        if (frame.op === 0x1) {
            text = "WRITE PHY " + frame.phy + " REG " + frame.dev_or_reg + " = " + mdio_format_value(frame.data, 16);
        }
        else if (frame.op === 0x2) {
            text = "READ PHY " + frame.phy + " REG " + frame.dev_or_reg + " -> " + mdio_format_value(frame.data, 16);
        }
        else {
            text = "OP=" + frame.op.toString(2) + " PHY " + frame.phy + " REG " + frame.dev_or_reg;
            frame.has_error = true;
        }
    }
    else {
        var dev_label = "DEV";
        switch (frame.op) {
            case 0x0:
                text = "ADDRESS PHY " + frame.phy + " DEV " + frame.dev_or_reg + " <- " + mdio_format_value(frame.data, 16);
                break;
            case 0x1:
                text = "WRITE PHY " + frame.phy + " DEV " + frame.dev_or_reg + " = " + mdio_format_value(frame.data, 16);
                break;
            case 0x2:
                text = "READ INC PHY " + frame.phy + " DEV " + frame.dev_or_reg + " -> " + mdio_format_value(frame.data, 16);
                break;
            case 0x3:
                text = "READ PHY " + frame.phy + " DEV " + frame.dev_or_reg + " -> " + mdio_format_value(frame.data, 16);
                break;
            default:
                text = "OP=" + frame.op.toString(2) + " PHY " + frame.phy + " DEV " + frame.dev_or_reg;
                frame.has_error = true;
                break;
        }
    }

    if (frame.has_crc) {
        text += frame.crc_valid ? " [CRC OK]" : " [CRC FAIL]";
    }

    return text;
}

function mdio_render_frame(frame) {
    var clause_label = (frame.clause === CLAUSE_22) ? "Clause 22" : "Clause 45";
    var title_color = frame.has_error ? pktclr.err : pktclr.title;
    var content_color = frame.has_error ? pktclr.err : pktclr.title;

    ScanaStudio.packet_view_add_packet(true, ch_mdio, frame.full_start - frame.margin, frame.full_end + frame.margin,
        "MDIO " + clause_label, frame.summary, title_color, content_color);

    if (frame.preamble && show_preamble_item) {
        var pre_end = frame.start_sample - 1;
        var pre_start = frame.preamble.start_sample;
        ScanaStudio.dec_item_new(ch_mdio, pre_start - frame.margin, pre_end + frame.margin);
        ScanaStudio.dec_item_add_content("Preamble (" + frame.preamble.count + " bits)");
        ScanaStudio.dec_item_add_content("Preamble");
        ScanaStudio.dec_item_add_content("PRE");
        ScanaStudio.dec_item_end();

        ScanaStudio.packet_view_add_packet(false, ch_mdio, pre_start - frame.margin, pre_end + frame.margin,
            "Preamble", frame.preamble.count + " x '1'", pktclr.pre,
            pktclr.pre);
    }

    mdio_render_field(frame, 0, 2, "Start", "ST", mdio_bits_to_string(frame.bit_infos.slice(0, 2).map(function (b) { return b.bit; })),
        pktclr.control, pktclr.control, "none");

    mdio_render_op(frame);
    mdio_render_address_fields(frame);
    mdio_render_turnaround(frame);
    mdio_render_data(frame);
    if (frame.has_crc) {
        mdio_render_crc(frame);
    }
}

function mdio_render_field(frame, start_idx, bit_count, long_label, short_label, value_str, title_color, content_color, emphasis) {
    var range = mdio_compute_range(frame, start_idx, bit_count);
    ScanaStudio.dec_item_new(ch_mdio, range.start, range.end);
    ScanaStudio.dec_item_add_content(long_label + ": " + value_str);
    ScanaStudio.dec_item_add_content(short_label + " " + value_str);
    ScanaStudio.dec_item_add_content(value_str);

    for (var i = start_idx; i < (start_idx + bit_count); i++) {
        ScanaStudio.dec_item_add_sample_point(frame.bit_infos[i].sample_index, frame.bit_infos[i].bit.toString());
    }

    if (emphasis === "error") {
        ScanaStudio.dec_item_emphasize_error();
    }
    else if (emphasis === "warning") {
        ScanaStudio.dec_item_emphasize_warning();
    }
    else if (emphasis === "success") {
        ScanaStudio.dec_item_emphasize_success();
    }

    ScanaStudio.dec_item_end();

    ScanaStudio.packet_view_add_packet(false, ch_mdio, range.start, range.end, long_label, value_str, title_color, content_color);
}

function mdio_render_op(frame) {
    var label = "OP";
    var op_str = mdio_pad_binary(frame.op, 2);
    var long = "Op:  " + op_str;
    var colors = {
        title: pktclr.control,
        content: pktclr.control
    };
    var emphasis = "none";

    switch (frame.clause) {
        case CLAUSE_22:
            if (frame.op === 0x1) {
                long = "Op:  Write";
            }
            else if (frame.op === 0x2) {
                long = "Op:  Read";
            }
            else {
                long = "Op:  Reserved (" + op_str + ")";
                frame.has_error = true;
                emphasis = "error";
            }
            break;
        case CLAUSE_45:
            if (frame.op === 0x0) {
                long = "Op:  Address";
            }
            else if (frame.op === 0x1) {
                long = "Op:  Write";
            }
            else if (frame.op === 0x2) {
                long = "Op:  Read increment";
            }
            else if (frame.op === 0x3) {
                long = "Op:  Read";
            }
            else {
                emphasis = "error";
                frame.has_error = true;
            }
            break;
        default:
            break;
    }

    mdio_render_field(frame, 2, 2, long, label, op_str, colors.title, colors.content, emphasis);
}

function mdio_render_address_fields(frame) {
    var phy_str = "PHY " + mdio_format_value(frame.phy, 5);
    mdio_render_field(frame, 4, 5, "PHY address: " + frame.phy, "PHY", phy_str,
        pktclr.address, pktclr.address, "none");

    var field_label = (frame.clause === CLAUSE_22) ? "Register" : "Device";
    var field_value = (frame.clause === CLAUSE_22) ? frame.dev_or_reg : frame.dev_or_reg;
    var formatted = field_label + " " + mdio_format_value(field_value, 5);

    mdio_render_field(frame, 9, 5, field_label + " address", field_label.substring(0, 3), formatted,
        pktclr.address, pktclr.address, "none");
}

function mdio_render_turnaround(frame) {
    var expected = null;

    if (frame.clause === CLAUSE_22) {
        expected = 0x2; // 10

    }
    else {
        if (frame.op <= 0x1) {
            expected = 0x2; // Address/write
        }
        else {
            expected = 0x0; // Read operations release line
        }
    }

    var ta_str = mdio_pad_binary(frame.ta, 2);
    var warning = false;

    if ((expected !== null) && (frame.ta !== expected)) {
        warning = warn_ta;
    }

    var ta_emphasis = warning ? "warning" : "none";

    mdio_render_field(frame, 14, 2, "Turnaround", "TA", ta_str,
        pktclr.control, pktclr.control, ta_emphasis);
}

function mdio_render_data(frame) {
    var data_str = mdio_format_value(frame.data, 16);
    mdio_render_field(frame, frame.data_start_index, 16, "Data", "DATA", data_str,
        pktclr.data, pktclr.data, "none");
}

function mdio_render_crc(frame) {
    var crc_value = mdio_format_value(frame.crc, 16);
    var label = "CRC";
    var long_label = frame.crc_valid ? "CRC OK" : "CRC error";

    if (frame.crc_algorithm && frame.crc_algorithm.length > 0) {
        long_label += " [" + frame.crc_algorithm + "]";
    }

    var value = crc_value;
    if (!frame.crc_valid) {
        value += " (expected " + mdio_format_value(frame.crc_expected, 16) + ")";
    }

    var emphasis = frame.crc_valid ? "success" : "error";

    mdio_render_field(frame, frame.crc_start_index, 16, long_label, label, value,
        pktclr.control, pktclr.control, emphasis);
}

function mdio_compute_range(frame, start_idx, bit_count) {
    var first = frame.bit_infos[start_idx].sample_index;
    var last = frame.bit_infos[start_idx + bit_count - 1].sample_index;
    return {
        start: first - frame.margin,
        end: last + frame.margin
    };
}

// -----------------------------------------------------------------------------
// Demo signal builder
// -----------------------------------------------------------------------------

function on_draw_gui_signal_builder() {
    ScanaStudio.gui_add_ch_selector("ch_mdio", "MDIO data", "MDIO");
    ScanaStudio.gui_add_ch_selector("ch_mdc", "MDC clock", "MDC");
}

function on_eval_gui_signal_builder() {
    var data_ch = ScanaStudio.gui_get_value("ch_mdio");
    var clk_ch = ScanaStudio.gui_get_value("ch_mdc");
    if (data_ch == clk_ch) {
        return "Please assign different channels to data and clock.";
    }
    return "";
}

function on_build_demo_signals() {
    var mdio_ch = ScanaStudio.gui_get_value("ch_mdio");
    var mdc_ch = ScanaStudio.gui_get_value("ch_mdc");
    var freq = ScanaStudio.get_capture_sample_rate() / 50;

    if (freq <= 0) {
        freq = ScanaStudio.builder_get_sample_rate() / 150;
    }

    var sample_rate = ScanaStudio.builder_get_sample_rate();
    var half_period = Math.max(1, Math.floor(sample_rate / (freq * 2)));
    var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
    var idle_period = (samples_to_build / (2 * half_period)) / 20;
    var pause_period = samples_to_build / 50;

    var last_clk = 0;
    var last_data = 1;

    function hold(level_clk, level_data, samples) {
        last_clk = level_clk;
        last_data = level_data;
        ScanaStudio.builder_add_samples(mdc_ch, level_clk, samples);
        ScanaStudio.builder_add_samples(mdio_ch, level_data, samples);
    }

    function push_bit(bit) {
        hold(0, bit, half_period);
        hold(1, bit, half_period);
    }

    function push_bits(value, count) {
        for (var i = count - 1; i >= 0; i--) {
            push_bit((value >> i) & 0x1);
        }
    }

    function push_clause22(op, phy, reg, data, include_preamble) {
        if (include_preamble) {
            for (var i = 0; i < 32; i++) {
                push_bit(1);
            }
        }
        push_bits(0x1, 2); // Start 01
        push_bits(op, 2);
        push_bits(phy & 0x1F, 5);
        push_bits(reg & 0x1F, 5);
        push_bits((op === 0x1) ? 0x2 : 0x2, 2);
        push_bits(data & 0xFFFF, 16);
    }

    function push_idle(cycles) {
        for (var c = 0; c < cycles; c++) {
            hold(0, 1, half_period);
            hold(1, 1, half_period);
        }
    }

    function push_pause(samples) {
        ScanaStudio.builder_add_samples(mdc_ch, 1, samples);
        ScanaStudio.builder_add_samples(mdio_ch, 1, samples);
    }

    var data_counter = 0;
    while (ScanaStudio.builder_get_samples_acc(mdc_ch) < samples_to_build) {
        //random data between 0x0000 and 0xFFFF
        data_counter = Math.floor(Math.random() * 0x10000);

        hold(0, 1, half_period * 8);
        push_clause22(0x1, 1, 0x0, data_counter, true);
        push_idle(4);
        push_clause22(0x2, 3, 0x4, data_counter, true);
        push_pause(pause_period);

        data_counter+= 250;
    }
    
}

// -----------------------------------------------------------------------------
// Trigger builder
// -----------------------------------------------------------------------------

function on_build_trigger() {
    reload_dec_gui_values();

    var frame_type = ScanaStudio.gui_get_value("trig_frame_type");
    var match_phy = ScanaStudio.gui_get_value("trig_match_phy");
    var match_devreg = ScanaStudio.gui_get_value("trig_match_devreg");
    var match_data = ScanaStudio.gui_get_value("trig_match_data");
    var include_preamble = ScanaStudio.gui_get_value("trig_include_preamble");

    var phy = parse_gui_integer(ScanaStudio.gui_get_value("trig_phy")) & 0x1F;
    var reg = parse_gui_integer(ScanaStudio.gui_get_value("trig_reg")) & 0x1F;
    var data = parse_gui_integer(ScanaStudio.gui_get_value("trig_data")) & 0xFFFF;

    function append_bit(bit) {
        var step = "";
        for (var i = 0; i < ScanaStudio.get_device_channels_count(); i++) {
            if (i == ch_mdc) {
                step = "R" + step;
            }
            else if (i == ch_mdio) {
                if (bit === -1) {
                    step = "X" + step;
                }
                else {
                    step = bit.toString() + step;
                }
            }
            else {
                step = "X" + step;
            }
        }
        ScanaStudio.flexitrig_append(step, -1, -1);

        step = "";
        for (i = 0; i < ScanaStudio.get_device_channels_count(); i++) {
            if (i == ch_mdc) {
                step = "F" + step;
            }
            else if (i == ch_mdio) {
                if (bit === -1) {
                    step = "X" + step;
                }
                else {
                    step = bit.toString() + step;
                }
            }
            else {
                step = "X" + step;
            }
        }
        ScanaStudio.flexitrig_append(step, -1, -1);
    }

    function append_bits(value, width, care) {
        for (var i = width - 1; i >= 0; i--) {
            if (care) {
                append_bit((value >> i) & 0x1);
            }
            else {
                append_bit(-1);
            }
        }
    }

    function append_preamble(bits) {
        for (var i = 0; i < bits; i++) {
            append_bit(1);
        }
    }

    if (include_preamble) {
        append_preamble(32);
    }

    if (frame_type <= 2) { // Clause 22 variants
        append_bits(0x1, 2, true);
        if (frame_type === 1) {
            append_bits(0x1, 2, true);
        }
        else if (frame_type === 2) {
            append_bits(0x2, 2, true);
        }
        else {
            append_bits(0x0, 2, false);
        }

        append_bits(phy, 5, match_phy);
        append_bits(reg, 5, match_devreg);
        append_bits(0x2, 2, false);
        append_bits(data, 16, match_data);
    }
    else { // Clause 45
        append_bits(0x0, 2, true);
        var op;
        switch (frame_type) {
            case 3: // Any
                append_bits(0x0, 2, false);
                break;
            case 4: // Address
                op = 0x0;
                append_bits(op, 2, true);
                break;
            case 5: // Write
                op = 0x1;
                append_bits(op, 2, true);
                break;
            case 6: // Read
                op = 0x3;
                append_bits(op, 2, true);
                break;
            case 7: // Read increment
                op = 0x2;
                append_bits(op, 2, true);
                break;
            default:
                append_bits(0x0, 2, false);
                break;
        }

        append_bits(phy, 5, match_phy);
        append_bits(reg, 5, match_devreg);
        append_bits(0x0, 2, false);
        append_bits(data, 16, match_data);
    }

    ScanaStudio.flexitrig_print_steps();
}

// -----------------------------------------------------------------------------
// Utility helpers
// -----------------------------------------------------------------------------

function parse_gui_integer(text) {
    if (typeof text === "number") {
        return text;
    }
    if (typeof text !== "string") {
        throw "Invalid numeric value.";
    }
    var value = 0;
    if (text.indexOf("0x") === 0 || text.indexOf("0X") === 0) {
        value = parseInt(text, 16);
    }
    else if (text.indexOf("0b") === 0 || text.indexOf("0B") === 0) {
        value = parseInt(text.substring(2), 2);
    }
    else {
        value = parseInt(text, 10);
    }

    if (isNaN(value)) {
        throw "Invalid numeric value.";
    }
    return value;
}