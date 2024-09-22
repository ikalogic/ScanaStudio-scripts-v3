/* Protocol meta info:
<NAME> Memory bus </NAME>
<DESCRIPTION>
This script decodes memory bus transactions, showing address, data and control lines.
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
var control_width;
var data_width;
var address_width;
var data_channels;
var addr_channels;
var ctrl_channels, ctrl_aliases;
var ctrl_trs;
var last_trs_reached = false;
var sampling_rate;
var state_machine;
var capture_point;
var prev_capture_point;
var ctrl_val, prev_ctrl_val;
var data_val, addr_val;
var address_order, data_order;
var addr_format, data_format, ctrl_format;

function on_get_n_pages_gui_decoder() {
    return 5;
}

//Decoder GUI
function on_draw_gui_decoder(page_number) {
    switch (page_number) {
        case 0:
            //define the parameter of the memory bus
            ScanaStudio.gui_add_info_label("Step 1: Define memory bus parameters", page_number);
            ScanaStudio.gui_add_combo_box("data_width" /* string */, "Data bus width" /* string */, page_number);
            for (var i = 4; i <= 32; i++) {
                ScanaStudio.gui_add_item_to_combo_box(i.toString() /* string */, (i == 8) /* bool [default = false] */);
            }
            ScanaStudio.gui_add_combo_box("data_order" /* string */, "Data bit order" /* string */, page_number);
            ScanaStudio.gui_add_item_to_combo_box("MSB first" /* string */, true /* bool [default = false] */);
            ScanaStudio.gui_add_item_to_combo_box("LSB first" /* string */, false /* bool [default = false] */);
            ScanaStudio.gui_add_combo_box("data_format" /* string */, "Data format" /* string */, page_number);
            ScanaStudio.gui_add_item_to_combo_box("Dec" /* string */, true /* bool [default = false] */);
            ScanaStudio.gui_add_item_to_combo_box("Hex" /* string */, false /* bool [default = false] */);
            ScanaStudio.gui_add_item_to_combo_box("Binary" /* string */, false /* bool [default = false] */);
            ScanaStudio.gui_add_item_to_combo_box("ASCII" /* string */, false /* bool [default = false] */);
            ScanaStudio.gui_add_separator("" /* string [default = ""] */, page_number);

            ScanaStudio.gui_add_combo_box("address_width" /* string */, "Address bus width" /* string */, page_number);
            for (var i = 4; i <= 32; i++) {
                ScanaStudio.gui_add_item_to_combo_box(i.toString() /* string */, (i == 12) /* bool [default = false] */);
            }
            ScanaStudio.gui_add_combo_box("address_order" /* string */, "Address bit order" /* string */, page_number);
            ScanaStudio.gui_add_item_to_combo_box("MSB first" /* string */, true /* bool [default = false] */);
            ScanaStudio.gui_add_item_to_combo_box("LSB first" /* string */, false /* bool [default = false] */);
            ScanaStudio.gui_add_combo_box("addr_format" /* string */, "Address format" /* string */, page_number);
            ScanaStudio.gui_add_item_to_combo_box("Dec" /* string */, false /* bool [default = false] */);
            ScanaStudio.gui_add_item_to_combo_box("Hex" /* string */, true /* bool [default = false] */);
            ScanaStudio.gui_add_item_to_combo_box("Binary" /* string */, false /* bool [default = false] */);
            ScanaStudio.gui_add_separator("" /* string [default = ""] */, page_number);


            ScanaStudio.gui_add_combo_box("control_width" /* string */, "Control bus width" /* string */, page_number);
            for (var i = 1; i <= 12; i++) {
                ScanaStudio.gui_add_item_to_combo_box(i.toString() /* string */, (i == 5) /* bool [default = false] */);
            }
            ScanaStudio.gui_add_combo_box("ctrl_format" /* string */, "Control bits format" /* string */, page_number);
            ScanaStudio.gui_add_item_to_combo_box("Dec" /* string */, false /* bool [default = false] */);
            ScanaStudio.gui_add_item_to_combo_box("Hex" /* string */, false /* bool [default = false] */);
            ScanaStudio.gui_add_item_to_combo_box("Binary" /* string */, false /* bool [default = false] */);
            ScanaStudio.gui_add_item_to_combo_box("Signal names (Ex: WR=1, RD=0, CE=0, etc...)" /* string */, true /* bool [default = false] */);

            break;


        case 1:
            ScanaStudio.gui_add_info_label("Step 2: Data bus definition", page_number);
            data_width = ScanaStudio.gui_get_value("data_width") + 4;
            //Attribute channels number to bus
            for (var i = 0; i < data_width; i++) {
                ScanaStudio.gui_add_ch_selector("data_" + i /* string */,
                    "DATA " + i.toString() /* string */,
                    "D" + i.toString() /* string */,
                    i,
                    page_number);
            }
            break;
        case 2:
            ScanaStudio.gui_add_info_label("Step 3: Address bus definition", page_number);
            address_width = ScanaStudio.gui_get_value("address_width") + 4;
            data_width = ScanaStudio.gui_get_value("data_width") + 4;
            //Attribute channels number to bus
            for (var i = 0; i < address_width; i++) {
                ScanaStudio.gui_add_ch_selector("addr_" + i /* string */,
                    "ADDRESS " + i.toString() /* string */,
                    "A" + i.toString() /* string */,
                    i + data_width,
                    page_number);
            }
            break;
        case 3:
            ScanaStudio.gui_add_info_label("Step 4: control bus renaming", page_number);
            control_width = ScanaStudio.gui_get_value("control_width") + 1;
            //Attribute channels number to bus
            for (var i = 0; i < control_width; i++) {
                var def = "Control line " + i;
                if (i == 0) {
                    def = "WR";
                }
                else if (i == 1) {
                    def = "RD";
                }
                else if (i == 2) {
                    def = "CE";
                }
                ScanaStudio.gui_add_text_input("ctrl_alias_" + i /* string */,
                    "Control line " + i /* string */,
                    def /* string */,
                    page_number);
            }
            break;
        case 4:
            ScanaStudio.gui_add_info_label("Step 5: control bus definition\nA new trasaction is captured for each control bus state change", page_number);
            address_width = ScanaStudio.gui_get_value("address_width") + 4;
            data_width = ScanaStudio.gui_get_value("data_width") + 4;
            control_width = ScanaStudio.gui_get_value("control_width") + 1;
            ctrl_aliases = [];
            for (var i = 0; i < control_width; i++) {
                ctrl_aliases.push(ScanaStudio.gui_get_value("ctrl_alias_" + i));
            }
            //Attribute channels number to bus
            for (var i = 0; i < control_width; i++) {
                ScanaStudio.gui_add_ch_selector("ctrl_" + i /* string */,
                    ctrl_aliases[i] /* string */,
                    ctrl_aliases[i] /* string */,
                    i + data_width + address_width,
                    page_number);
            }
            break;

        default:
            break;
    }
}



//Evaluate decoder GUI
function on_eval_gui_decoder() {
    //ScanaStudio.console_error_msg("Hey");
    return ""; //All good.
}




function on_decode_signals(resume) {

    if (!resume) //If resume == false, it's the first call to this function.
    {
        //initialization code goes here, ex:
        state_machine = 0;
        sampling_rate = ScanaStudio.get_capture_sample_rate();
        last_trs_reached = false;

        address_width = ScanaStudio.gui_get_value("address_width") + 4;
        data_width = ScanaStudio.gui_get_value("data_width") + 4;
        control_width = ScanaStudio.gui_get_value("control_width") + 1;
        address_order = ScanaStudio.gui_get_value("address_order");
        data_order = ScanaStudio.gui_get_value("data_order");
        data_format = ScanaStudio.gui_get_value("data_format");
        addr_format = ScanaStudio.gui_get_value("addr_format");
        ctrl_format = ScanaStudio.gui_get_value("ctrl_format");
        data_channels = [];
        addr_channels = [];
        ctrl_channels = [];
        ctrl_aliases = [];
        for (var i = 0; i < data_width; i++) {
            data_channels.push(ScanaStudio.gui_get_value("data_" + i));
        }
        for (var i = 0; i < address_width; i++) {
            addr_channels.push(ScanaStudio.gui_get_value("addr_" + i));
        }
        for (var i = 0; i < control_width; i++) {
            ctrl_channels.push(ScanaStudio.gui_get_value("ctrl_" + i));
            ctrl_aliases.push(ScanaStudio.gui_get_value("ctrl_alias_" + i));
        }
        // ScanaStudio.console_info_msg("data_channels " + data_channels);
        // ScanaStudio.console_info_msg("addr_channels " + addr_channels);
        // ScanaStudio.console_info_msg("ctrl_channels " + ctrl_channels);
        // ScanaStudio.console_info_msg("Data order " + data_order);
        // ScanaStudio.console_info_msg("Ctrl format " + ctrl_format);
        // ScanaStudio.console_info_msg("ctrl_aliases " + ctrl_aliases);


        //Reset control iterators
        ctrl_trs = [];
        for (var i = 0; i < control_width; i++) {
            ScanaStudio.trs_reset(ctrl_channels[i]);
            ctrl_trs.push(ScanaStudio.trs_get_next(ctrl_channels[i]));
        }
        capture_point = get_next_capture_point();
        //skip first transition
        prev_capture_point = capture_point;
        prev_ctrl_val = ctrl_val;
        capture_point = get_next_capture_point();
        ctrl_val = capture_ctrl();
    }

    while (ScanaStudio.abort_is_requested() == false) {
        if (is_last_trs()) {
            break;
        }
        prev_capture_point = capture_point;
        prev_ctrl_val = ctrl_val;
        capture_point = get_next_capture_point();
        ctrl_val = capture_ctrl();
        data_val = capture_data_at(prev_capture_point, data_order);
        addr_val = capture_address_at(prev_capture_point, address_order);
        // ScanaStudio.console_info_msg(
        //     format_ctrl(prev_ctrl_val, ctrl_format, control_width)
        //     + " Data = " + data_val.toString(2).lpad("0", data_width)
        //     + " Addr = " + addr_val.toString(2).lpad("0", address_width),
        //     prev_capture_point);
        // ScanaStudio.console_info_msg("end of capture point", capture_point);

        ScanaStudio.dec_item_new(data_channels[0] /* int */,
            prev_capture_point /* int */,
            capture_point /* int */);

        ScanaStudio.dec_item_add_content(
            format_ctrl(prev_ctrl_val, ctrl_format, control_width)
            + " Addr = " + format(addr_val, addr_format)
            + " Data = " + format(data_val, data_format)
        );

        ScanaStudio.dec_item_add_content(
            format_ctrl(prev_ctrl_val, ctrl_format, control_width)
            + " @ = " + format(addr_val, addr_format)
            + " D = " + format(data_val, data_format)
        );

        ScanaStudio.dec_item_add_content(
            format_ctrl(prev_ctrl_val, ctrl_format, control_width)
            + " @ = " + format(addr_val, addr_format)
        );

        ScanaStudio.dec_item_add_content(
            format_ctrl(prev_ctrl_val, ctrl_format, control_width)
        );

        ScanaStudio.dec_item_end();


        ScanaStudio.packet_view_add_packet(true /* bool */,
            data_channels[0] /* int */,
            prev_capture_point /* int */,
            capture_point /* int */,
            format_time(prev_capture_point / sampling_rate) /* string */,
            format(addr_val, addr_format) /* string */,
            ScanaStudio.PacketColors.Wrap.Title /* string */,
            ScanaStudio.PacketColors.Wrap.Content /* string */);

            ScanaStudio.packet_view_add_packet(false /* bool */,
            data_channels[0] /* int */,
            prev_capture_point /* int */,
            capture_point /* int */,
            "Control word" /* string */,
            format_ctrl(prev_ctrl_val, ctrl_format, control_width) /* string */,
            ScanaStudio.PacketColors.Head.Title /* string */,
            ScanaStudio.PacketColors.Head.Content /* string */);

            ScanaStudio.packet_view_add_packet(false /* bool */,
            data_channels[0] /* int */,
            prev_capture_point /* int */,
            capture_point /* int */,
            "Address" /* string */,
            format(addr_val, addr_format),
            ScanaStudio.PacketColors.Preamble.Title /* string */,
            ScanaStudio.PacketColors.Preamble.Content /* string */);

            ScanaStudio.packet_view_add_packet(false /* bool */,
            data_channels[0] /* int */,
            prev_capture_point /* int */,
            capture_point /* int */,
            "Data" /* string */,
            format(data_val, data_format),
            ScanaStudio.PacketColors.Data.Title /* string */,
            ScanaStudio.PacketColors.Data.Content /* string */);

    }
}


function capture_data_at(target_sample, lsb_first) {
    var ret = 0;
    for (var i = 0; i < data_width; i++) {
        var val = ScanaStudio.trs_get_before(data_channels[i], target_sample).value;
        //ScanaStudio.console_info_msg("trs before ch " + data_channels[i] + " = " + val, target_sample);
        if (lsb_first) {
            ret |= (val << i);
        }
        else {
            ret |= (val << (data_width - i - 1));
        }
    }
    return ret;
}

function capture_address_at(target_sample, lsb_first) {
    var ret = 0;
    for (var i = 0; i < address_width; i++) {
        var val = ScanaStudio.trs_get_before(addr_channels[i], target_sample).value;
        if (lsb_first) {
            ret |= (val << i);
        }
        else {
            ret |= (val << (address_width - i - 1));
        }
    }
    return ret;
}

function format_time(time_value) {
    return ScanaStudio.engineering_notation(time_value /* float */, 6 /* int */) + "s";
}

function format(value, format, width) {
    switch (format) {
        case 0: //dec
            return value.toString(10);
        case 1: //hex
            return "0x" + value.toString(16).lpad("0", width / 4);
            break;
        case 2: //binary
            return value.toString(2).lpad("0", width);
            break;
        case 3: //ascii
            return String.fromCharCode(value);
        default:
            return "?";
    }
}

function format_ctrl(value, format, width) {
    switch (format) {
        case 0: //dec
            return value.toString(10);
        case 1: //hex
            return value.toString(16).lpad("0", width / 4);
            break;
        case 2: //binary
            return value.toString(2).lpad("0", width);
            break;
        case 3: //Signal names
            var ret = "";
            for (var i = 0; i < width; i++) {
                ret += ctrl_aliases[i] + "(" + ((value >> i) & 0x1).toString() + ") ";
            }
            return ret;
        default:
            return "?";
    }
}

function capture_ctrl() {
    var ctrl_val = 0;
    for (var i = 0; i < control_width; i++) {
        var val = !ctrl_trs[i].value;
        //ScanaStudio.console_info_msg(val);
        ctrl_val |= (val << i);
    }
    return ctrl_val;
}

function get_next_capture_point() {
    //find the most lagging channel
    var lag_point = ctrl_trs[0].sample_index;
    for (var i = 0; i < control_width; i++) {
        if (ctrl_trs[i].sample_index < lag_point) {
            lag_point = ctrl_trs[i].sample_index;
        }
    }
    //ScanaStudio.console_info_msg("lag point = " + lag_point /* string */,lag_point /* int [default = -1] */);
    //advance only lagging channel(s)
    for (var i = 0; i < control_width; i++) {
        if (ctrl_trs[i].sample_index <= lag_point) {
            //ScanaStudio.console_info_msg("Advancing ch" + i /* string */);
            if (ScanaStudio.trs_is_not_last(ctrl_channels[i])) {
                ctrl_trs[i] = ScanaStudio.trs_get_next(ctrl_channels[i]);
            }
        }
    }
    return lag_point;
}

function is_last_trs() {
    last_trs = true;
    for (var i = 0; i < control_width; i++) {
        if (ScanaStudio.trs_is_not_last(ctrl_channels[i])) {
            last_trs = false;
        }
    }
    return last_trs;
}

String.prototype.lpad = function (padString, length) {
    var str = this;
    while (str.length < length)
        str = padString + str;
    return str;
}
