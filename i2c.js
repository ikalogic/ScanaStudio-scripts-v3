/* Protocol meta info:
<NAME> I2C </NAME>
<DESCRIPTION>
I2C support for ScanaStudio.
</DESCRIPTION>
<VERSION> 0.13 </VERSION>
<AUTHOR_NAME>  Ibrahim KAMAL, Alexander Goomenyuk </AUTHOR_NAME>
<AUTHOR_URL> i.kamal@ikalogic.com, emerg.reanimator@gmail.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright Ibrahim KAMAL </COPYRIGHT>
<LICENSE>  This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
v0.13: Fixed missing last stop condition/packet
v0.12: Added option to filter high-frequency noise
v0.11: Fix START/STOP conditions on screen width
v0.10: Fix bug related to extended address, Fix bug that caused decoding freeze in some cases
v0.9: Better packet view data display
v0.8: Added trigger capability
V0.7: Updated packet view
V0.6: Added hex and packet views
V0.5: Added dec_item_end() for each dec_item_new()
V0.4: Fixed warnings in script log when decoding random non-I2C signals
V0.3: Better demo mode generator
V0.2: Added support for 10b addresses, added support for pre-decoding
V0.1: Initial release
</RELEASE_NOTES>
*/

/*
  Define decoder configuration GUI
*/
function on_draw_gui_decoder()
{
    ScanaStudio.gui_add_ch_selector("ch_sda", "SDA Channel", "SDA");
    ScanaStudio.gui_add_ch_selector("ch_scl", "SCL Channel", "SCL");

    ScanaStudio.gui_add_new_tab("Advanced options", false);
        ScanaStudio.gui_add_combo_box("address_opt", "Address convention");
            ScanaStudio.gui_add_item_to_combo_box("7 bit address", true);
            ScanaStudio.gui_add_item_to_combo_box("8 bit address (inlcuding R/W flag)", false);
        ScanaStudio.gui_add_combo_box("address_format", "Address display format");
            ScanaStudio.gui_add_item_to_combo_box("HEX", true);
            ScanaStudio.gui_add_item_to_combo_box("Binary", false);
            ScanaStudio.gui_add_item_to_combo_box("Decimal", false);
        ScanaStudio.gui_add_combo_box("data_format", "Data display format");
            ScanaStudio.gui_add_item_to_combo_box("HEX", true);
            ScanaStudio.gui_add_item_to_combo_box("Binary", false);
            ScanaStudio.gui_add_item_to_combo_box("Decimal", false);
            ScanaStudio.gui_add_item_to_combo_box("ASCII", false);
        ScanaStudio.gui_add_check_box("en_noise_flter", "Ignore high-frequency noise on data and clock lines", false);
    ScanaStudio.gui_end_tab();
}

//Global variables
var I2C =
{
    ADDRESS     : 0x01,
    ACK         : 0x02,
    DATA        : 0x04,
    ADDRESS_EXT : 0x08
};


const DEBUG =
{
    NONE    : 0x00,
    TRS     : 0x01,
    STATE   : 0x02,
    DECOR   : 0x04,
}

// Initialize state variables
var state;
var restartBit;
var addressBits;
var ackBit;
var readBit;
var dataBits;

function I2C_PacketObject (root, st_sample, end_sample, title, content, title_color, content_color, extra_data)
{
    this.root = root;
    this.st_sample = st_sample;
    this.end_sample = end_sample;
    this.title = title;
    this.content = content;
    this.title_color = title_color;
    this.content_color = content_color;
    this.extra_data = extra_data;
};

var sampling_rate;
var state_machine;
var frame_state, last_frame_state;
var i2c_sample_points = [];
var i2c_packet_arr = [];

var ch_sda;
var ch_scl;
var address_opt;
var address_format;
var data_format;
var done;

var debug;

function decodeI2CData() 
{
    return;
}

function display_item(ch, long_name, short_name, start_sample, end_sample)
{
    ScanaStudio.dec_item_new(ch, start_sample, end_sample);
    ScanaStudio.dec_item_add_content(long_name);
    ScanaStudio.dec_item_add_content(short_name);
    ScanaStudio.dec_item_end();

    return;
}


function display_item_centered(ch, long_name, short_name, start_sample, end_sample, left)
{
    duration = end_sample - start_sample;

    if (left) {
        start_sample -= duration/2;
        end_sample -= duration/2;
    } else {
        start_sample += duration/2;
        end_sample += duration/2;
    }

    display_item(ch, long_name, short_name, start_sample, end_sample);

    return;
}


function process_start_condition(ch, start_sample, end_sample)
{
    item_st_sample = start_sample;
    item_end_sample = end_sample;

    display_item_centered(ch, "START", "S", start_sample, end_sample, true);

    i2c_packet_arr.push(new I2C_PacketObject(true, item_st_sample, item_end_sample, "I2C", "CH" + (ch + 1),
                                            ScanaStudio.get_channel_color(ch), ScanaStudio.get_channel_color(ch)));
    
    i2c_packet_arr.push(new I2C_PacketObject(false, item_st_sample, item_end_sample, "Start", "",
                                            ScanaStudio.PacketColors.Wrap.Title, ScanaStudio.PacketColors.Wrap.Content));

    return;
}


function process_stop_condition(ch, start_sample, end_sample)
{
    item_st_sample = start_sample;
    item_end_sample = end_sample;

    display_item_centered(ch, "STOP", "P", start_sample, end_sample, false);

    i2c_packet_arr.push(new I2C_PacketObject(false, item_st_sample, item_end_sample, "Stop", "",
                                            ScanaStudio.PacketColors.Wrap.Title, ScanaStudio.PacketColors.Wrap.Content));
    
    return;
}


function process_restart_condition(ch, start_sample, end_sample)
{
    item_st_sample = start_sample;
    item_end_sample = end_sample;

    display_item_centered(ch, "RE-START", "R", start_sample, end_sample, false);

    i2c_packet_arr.push(new I2C_PacketObject(false, item_st_sample, item_end_sample, "Re-start", "",
                                            ScanaStudio.PacketColors.Wrap.Title, ScanaStudio.PacketColors.Wrap.Content));
    
    return;
}


/**
 * @note addressBits are cleared in this function
 */
function process_address_and_readbit(addressBits, readBit, start_sample, end_sample)
{
    var i2c_byte_margin = (end_sample - start_sample) / 24;

    if ((start_sample-i2c_byte_margin) <= last_dec_item_end_sample)
    {
        item_st_sample = last_dec_item_end_sample + 1;
        item_end_sample = last_dec_item_end_sample + i2c_byte_margin;
        last_dec_item_end_sample += i2c_byte_margin;
    }
    else
    {
        item_st_sample = start_sample - i2c_byte_margin;
        item_end_sample = end_sample + i2c_byte_margin;
        last_dec_item_end_sample = end_sample + i2c_byte_margin;
    }

    byte = 0;
    if (debug & DEBUG.DECOR) ScanaStudio.console_info_msg("process_address_and_readbit() : addressBits = " + addressBits.toString(), start_sample)
    addressBits.reverse();
    while (addressBits.length > 0) {
        byte = (byte * 2) | addressBits.pop();
    }
    byte = byte * 2 | readBit;

    ScanaStudio.dec_item_new(ch_sda, item_st_sample, item_end_sample);

    if (ScanaStudio.is_pre_decoding() == true)
    {
        ScanaStudio.dec_item_add_content("0x" + byte.toString(16));
        bit_counter = 0;
        last_frame_state = frame_state;
        frame_state = I2C.ACK;
        ScanaStudio.dec_item_end();
        return;
    }

    if (byte == 0)                  // General call
    {
        operation_str = "General call";
        operation_str_short = "GC";
    }
    else if (byte == 1)             // General call
    {
        operation_str = "Start byte";
        operation_str_short = "SB";
    }
    else if ((byte>>1) == 1)        // CBUS
    {
        operation_str = "CBUS";
        operation_str_short = "CB";
    }
    else if (((byte>>1) == 2) || ((byte>>1) == 3) || ((byte>>3) == 0x1F))   // Reserved
    {
        operation_str = "Reserved";
        operation_str_short = "RES";
        ScanaStudio.dec_item_emphasize_warning();
    }
    else if ((byte>>3) == 1)        // HS-mode master code
    {
        hs_mode = true;
        operation_str = "HS-Mode master code";
        operation_str_short = "HS";
    }
    else if ((byte >> 3) == 0x1E)   // 10 bit (extended) address
    {
        add_10b = true;
        ext_add = (byte >> 1) & 0x3;

        if (byte & 0x1)
        {
            operation_str = "Read from (10-bit)";
            operation_str_short = "10R";
        }
        else
        {
            operation_str = "Write to (10-bit)";
            operation_str_short = "10W";
        }
    }
    else if (byte & 0x1)
    {
        operation_str = "Read from";
        operation_str_short = "RD";
    }
    else
    {
        operation_str = "Write to";
        operation_str_short = "WR";
    }

    if (address_opt == 0)               // 7 bit standard address convention
    {
        add_len = 7
        add_shift = 1;
    }
    else
    {
        add_len = 8;
        add_shift = 0;
    }

    if (debug & DEBUG.DECOR) ScanaStudio.console_info_msg("process_address_and_readbit() : byte = " + byte.toString(), sample_index)

    ScanaStudio.dec_item_add_content(operation_str + " " + format_content(byte >> add_shift, address_format, add_len) + " - R/W = " + (byte & 0x1).toString());
    ScanaStudio.dec_item_add_content(operation_str + " " + format_content(byte >> add_shift, address_format, add_len));
    ScanaStudio.dec_item_add_content(operation_str_short + " " + format_content(byte >> add_shift, address_format, add_len));
    ScanaStudio.dec_item_add_content(format_content(byte >> add_shift, address_format, add_len));
    ScanaStudio.dec_item_end();
    
    add_sample_points();
    
    var addr = format_content(byte >> add_shift, address_format, add_len)
    i2c_packet_arr.push(new I2C_PacketObject(false, item_st_sample, item_end_sample, "Address",
                                            operation_str + " " + addr,
                                            ScanaStudio.PacketColors.Preamble.Title,
                                            ScanaStudio.PacketColors.Preamble.Content,
                                            addr));
    
    last_frame_state = frame_state;
    frame_state = I2C.ACK;

    return;
}


function process_ackbit(ackBit, start_sample, end_sample)
{
    var duration = end_sample - start_sample;
    var item_st_sample = start_sample + duration/16;
    var item_end_sample = end_sample - duration/16;

    ScanaStudio.dec_item_new(ch_sda, item_st_sample, item_end_sample);
    var title_color = ScanaStudio.PacketColors.Check.Title;
    var content_color = ScanaStudio.PacketColors.Check.Content;

    if (ackBit == 1)
    {
        ScanaStudio.dec_item_add_content("NACK");
        ScanaStudio.dec_item_add_content("N");

        var title = "Nack";

        if (last_frame_state == I2C.ADDRESS)
        {
            title = "Addr Nack";
            title_color = ScanaStudio.PacketColors.Error.Title;
            content_color = ScanaStudio.PacketColors.Error.Content;
        }

        i2c_packet_arr.push(new I2C_PacketObject(false, item_st_sample, item_end_sample, title, "", title_color, content_color));
    }
    else
    {
        ScanaStudio.dec_item_add_content("ACK");
        ScanaStudio.dec_item_add_content("A");

        var title = "Ack";

        if (last_frame_state == I2C.ADDRESS)
        {
            title = "Addr Ack";
        }

        i2c_packet_arr.push(new I2C_PacketObject(false, item_st_sample, item_end_sample, title, "", title_color, content_color));
    }

    add_sample_points();
    ScanaStudio.dec_item_end();
    last_frame_state = frame_state;

    if (hs_mode)
    {
        frame_state = I2C.ADDRESS;
        hs_mode = false;
    }
    else if (add_10b == true)
    {
        add_10b = false;
        frame_state = I2C.ADDRESS_EXT;
    }
    else
    {
        frame_state = I2C.DATA;
    }

    return;
}


function process_data_byte(dataBits, start_sample, end_sample)
{
    i2c_byte_margin = (end_sample - start_sample) / 16;

    if (start_sample-i2c_byte_margin <= last_dec_item_end_sample)
    {
        item_st_sample = last_dec_item_end_sample + 1;
        item_end_sample = end_sample + i2c_byte_margin;
        last_dec_item_end_sample += i2c_byte_margin;
    }
    else
    {
        item_st_sample = start_sample - i2c_byte_margin;
        item_end_sample = end_sample + i2c_byte_margin;
        last_dec_item_end_sample = start_sample + i2c_byte_margin;
    }

    ScanaStudio.dec_item_new(ch_sda, item_st_sample, item_end_sample);

    byte = 0;
    dataBits.reverse();
    while (dataBits.length > 0) {
        byte = (byte * 2) | dataBits.pop();
    }

    if (ScanaStudio.is_pre_decoding() == true)
    {
        ScanaStudio.dec_item_add_content("0x" + byte.toString(16));
    }
    else
    {
        ScanaStudio.dec_item_add_content("DATA = " + format_content(byte, data_format, 8));
        ScanaStudio.dec_item_add_content(format_content(byte, data_format, 8));
        add_sample_points();
    }

    ScanaStudio.dec_item_end();
    ScanaStudio.hex_view_add_byte(ch_sda, item_st_sample, item_end_sample, byte);

    i2c_packet_arr.push(new I2C_PacketObject(false, item_st_sample, item_end_sample, "Data", format_content(byte, data_format, 8),
                        ScanaStudio.PacketColors.Data.Title, ScanaStudio.PacketColors.Data.Content));

    last_frame_state = frame_state;
    frame_state = I2C.ACK;

    return;
}


/*
  Get GUI values
*/
function reload_dec_gui_values()
{
    ch_sda         = ScanaStudio.gui_get_value("ch_sda");
    ch_scl         = ScanaStudio.gui_get_value("ch_scl");
    address_opt    = ScanaStudio.gui_get_value("address_opt");
    address_format = ScanaStudio.gui_get_value("address_format");
    data_format    = ScanaStudio.gui_get_value("data_format");
    en_noise_flter = ScanaStudio.gui_get_value("en_noise_flter");
}

function on_decode_signals (resume)
{
    var is_last_sda_trs;
    var is_last_scl_trs;

    var start_index;
    var ackBit;
    var nextState;
    var prevState;

    if (!resume) //If resume == false, it's the first call to this function.
    {
        sampling_rate = ScanaStudio.get_capture_sample_rate();
        reload_dec_gui_values();
        
        // ... Reset iterator
        ScanaStudio.trs_reset(ch_sda);
        ScanaStudio.trs_reset(ch_scl);

        trs_scl = ScanaStudio.trs_get_next(ch_scl);
        trs_sda = ScanaStudio.trs_get_next(ch_sda);

        // ... init global variables
        state_machine = 0;
        last_dec_item_end_sample = 0;
        add_10b = false;
        ext_add = 0;
        hs_mode = false;
        frame_state = I2C.ADDRESS;
        last_frame_state = frame_state;
        packet_started = false;
        byte_counter = 0;
        bit_counter = 0;
        byte = 0;
        done = 0;

        prevState = 'IDLE';
        state = 'IDLE';
        restartBit = false;
        addressBits = [];
        readBit = false;
        dataBits = [];

        is_last_sda_trs = false;
        is_last_scl_trs = false;

        debug = DEBUG.NONE;
    }
    else
    {
        //ScanaStudio.console_info_msg("Decoding resumed");
    }

    while (ScanaStudio.abort_is_requested() == false)
    {
        sample_index = 0;

        if (debug & DEBUG.TRS) ScanaStudio.console_info_msg("on_decode_signals() : trs_scl " + trs_scl.sample_index, trs_scl.sample_index);
        if (debug & DEBUG.TRS) ScanaStudio.console_info_msg("on_decode_signals() : trs_sda " + trs_sda.sample_index, trs_sda.sample_index);

        switch (state_machine)
        {
            case 0: //Advance SDA iterator and detect bits or conditions
                last_trs_sda = trs_sda;                
                trs_sda = ScanaStudio.trs_get_next(ch_sda);
                
                last_trs_scl = trs_scl;
                trs_scl = ScanaStudio.trs_get_next(ch_scl);

                while (check_signal_noise(trs_scl, last_trs_scl))
                {
                    last_trs_scl = trs_scl;
                    trs_scl = ScanaStudio.trs_get_next(ch_scl);
                }

                sample_index = trs_sda.sample_index;

                state_machine = 1;
            break;

            case 1:
                // ... Edge decoding
                while (check_signal_noise(trs_sda, last_trs_sda))
                {
                    last_trs_sda = trs_sda;
                    trs_sda = ScanaStudio.trs_get_next(ch_sda);
                }

                SDA_edgeType = 'NONE';
                if ((last_trs_sda.value === 0) && (trs_sda.value == 1)) {
                    SDA_edgeType = 'SDA_RISING';
                    if (debug & DEBUG.TRS) ScanaStudio.console_info_msg("on_decode_signals() : SDA_RISING " + trs_sda.sample_index, trs_sda.sample_index);
                }
                else if ((last_trs_sda.value === 1) && (trs_sda.value === 0)) {
                    SDA_edgeType = 'SDA_FALLING';
                    if (debug & DEBUG.TRS) ScanaStudio.console_info_msg("on_decode_signals() : SDA_FALLING " + trs_sda.sample_index, trs_sda.sample_index);
                }
                else {
                    if (debug & DEBUG.TRS) ScanaStudio.console_warning_msg("on_decode_signals() : Unhandled SDA state " + trs_sda.sample_index + ", last_trs_sda.sample_index = " + last_trs_sda.sample_index, trs_sda.sample_index);
                }
                
                SCL_edgeType = 'NONE';
                if ((last_trs_scl.value === 0) && (trs_scl.value === 1)) {
                    SCL_edgeType = 'SCL_RISING';
                    if (debug & DEBUG.TRS) ScanaStudio.console_info_msg("on_decode_signals() : SCL_RISING " + trs_scl.sample_index, trs_scl.sample_index);
                }
                else if ((last_trs_scl.value === 1) && (trs_scl.value === 0)) {
                    SCL_edgeType = 'SCL_FALLING';
                    if (debug & DEBUG.TRS) ScanaStudio.console_info_msg("on_decode_signals() : SCL_FALLING " + trs_scl.sample_index, trs_scl.sample_index);
                }
                else {
                    if (debug & DEBUG.TRS) ScanaStudio.console_warning_msg("on_decode_signals() : Unhandled SCL state, trs_scl.sample_index = " + trs_scl.sample_index + ", last_trs_scl.sample_index = " + last_trs_scl.sample_index, trs_scl.sample_index);
                }

                if (debug & DEBUG.TRS) ScanaStudio.console_info_msg("on_decode_signals() : is_last_sda_trs = " + is_last_sda_trs + ", is_last_scl_trs = " + is_last_scl_trs);

                if (debug & DEBUG.TR) ScanaStudio.console_info_msg("on_decode_signals() : edgeType = " + edgeType + ", sample_index = " + sample_index, sample_index);

                if (last_trs_scl.sample_index == trs_scl.sample_index) {
                    if (debug & DEBUG.TRS) ScanaStudio.console_info_msg("on_decode_signals() : last SCL transition " + trs_scl.sample_index, trs_scl.sample_index);
                    is_last_scl_trs = true;
                    
                }

                if (last_trs_sda.sample_index == trs_sda.sample_index) {
                    if (debug & DEBUG.TRS) ScanaStudio.console_info_msg("on_decode_signals() : last SDA transition " + trs_sda.sample_index, trs_sda.sample_index);
                    is_last_sda_trs = true;
                }

                if (is_last_sda_trs && is_last_scl_trs) {
                    if (debug & DEBUG.TRS) ScanaStudio.console_info_msg("on_decode_signals() : final");
                    state_machine = 2;
                }

                if ((trs_sda.sample_index < trs_scl.sample_index) || (true == is_last_scl_trs)) {
                    edgeType = SDA_edgeType;
                    sample_index = trs_sda.sample_index;
                    if (false) ScanaStudio.console_info_msg("on_decode_signals() : edgeType = " + edgeType + ", value = " + trs_sda.value,  sample_index);
                }
                else {
                    edgeType = SCL_edgeType;
                    sample_index = trs_scl.sample_index;
                    if (false) ScanaStudio.console_info_msg("on_decode_signals() : edgeType = " + edgeType + ", value = " + trs_scl.value,  sample_index);
                }

                // ... FSM
                if ('IDLE' === state) {
                    if ('SDA_FALLING' === edgeType) {
                        nextState = 'START_BIT';
                        if (debug & DEBUG.STATE) ScanaStudio.console_info_msg("on_decode_signals() : state = " + state + ", nextState = " + nextState, sample_index);
                    }
                } else if (state === 'START_BIT') {
                    if ('SCL_RISING' === edgeType) {
                        startBit = true;
                        restartBit = false;
    
                        start_sample = last_trs_sda.sample_index;
                        end_sample = sample_index;
    
                        process_start_condition(ch_sda, start_sample, end_sample);
    
                        if (addressBits.length === 0) {
                            start_index = sample_index;
                        }

                        addrBit = last_trs_sda.value;
                        addressSize = 7;
                        if (0 != address_opt) addressSize = 8;
                        
                        if (addressBits.length < addressSize) {
                            if (debug & DEBUG.STATE) ScanaStudio.console_info_msg("on_decode_signals() : state = " + state + ', addressBit[' + (addressSize - addressBits.length - 1) + '] = ' + addrBit, sample_index);
                            i2c_sample_points.push(sample_index);
                            addressBits.push(addrBit);
                        } 
                        nextState = 'ADDRESS';
                        if (debug & DEBUG.STATE) ScanaStudio.console_info_msg("on_decode_signals() : state = " + state + ", nextState = " + nextState, sample_index);
                    }
                } else if (state === 'ADDRESS') {
                    addressSize = 7;
                    if (0 != address_opt) addressSize = 8;
                    if ('SCL_RISING' === edgeType) {
                        addrBit = last_trs_sda.value;
                        if (addressBits.length < addressSize) {
                            if (debug & DEBUG.STATE) ScanaStudio.console_info_msg("on_decode_signals() : state = " + state + ', addressBit[' + (addressSize - addressBits.length - 1) + '] = ' + addrBit, sample_index);
                            i2c_sample_points.push(sample_index);
                            addressBits.push(addrBit);
                        } 
                        
                        if (addressBits.length < addressSize) {
                            nextState = 'ADDRESS';
                        } else {
                            nextState = 'READ_BIT';
                        }
                    }
                } else if (state === 'READ_BIT') {
                    if ('SCL_RISING' === edgeType) {
                        readBit = last_trs_sda.value;
                        i2c_sample_points.push(sample_index);
                        process_address_and_readbit(addressBits, readBit, start_index, sample_index);

                        if (debug & DEBUG.STATE) ScanaStudio.console_info_msg("on_decode_signals() : state = " + state + ', readBit = ' + readBit, sample_index);
                        nextState = 'ACK';
                    }
                } else if ('ACK' === state) {
                    if ('SCL_FALLING' === edgeType) {
                        start_index = sample_index;
                    }
                    else if ('SCL_RISING' === edgeType) {
                        dataBits = [];
                        i2c_sample_points.push(sample_index);
                        ackBit = last_trs_sda.value;

                        if (debug & DEBUG.STATE) ScanaStudio.console_info_msg("on_decode_signals() : state = " + state + ', ackBit = ' + ackBit, sample_index);
                        nextState = 'DATA';
                    }                    
                } else if (state === 'DATA') {
                    if (('SCL_FALLING' === edgeType) && ('ACK' === prevState)) {
                        process_ackbit(ackBit, start_index, sample_index);
                    }
                    else if ('SCL_RISING' === edgeType) {
                        if (dataBits.length === 0) {
                            start_index = sample_index;
                        }

                        const dataSize = 8;
                        dataBit = last_trs_sda.value;
                        if (dataBits.length < dataSize) {
                            if (debug & DEBUG.STATE) ScanaStudio.console_info_msg("on_decode_signals() : state = " + state + ', dataBit[' + (dataSize - dataBits.length - 1) + '] = ' + dataBit, sample_index);
                            i2c_sample_points.push(sample_index);
                            dataBits.push(dataBit);
                        }

                        if (dataSize === dataBits.length) {
                            process_data_byte(dataBits, start_index, sample_index);
                            nextState = 'ACK';
                        } 
                    } else if (('SDA_RISING' === edgeType) && (last_trs_scl.value === 1)) {
                        dataBits = [];
                        if (debug & DEBUG.STATE) ScanaStudio.console_info_msg("on_decode_signals() : state = " + state, sample_index);

                        start_sample = last_trs_sda.sample_index;
                        end_sample = sample_index;
    
                        process_stop_condition(ch_sda, start_sample, end_sample);
                        update_packet_view();

                        nextState = 'IDLE';
                    } else if ('SDA_FALLING' === edgeType && (last_trs_scl.value === 1)) {
                        if (debug & DEBUG.STATE) ScanaStudio.console_info_msg("on_decode_signals() : state = " + state, sample_index);
                        dataBits = [];

                        start_sample = last_trs_sda.sample_index;
                        end_sample = sample_index;
    
                        process_restart_condition(ch_sda, start_sample, end_sample);
                        update_packet_view();

                        nextState = 'DATA';
                    }
                } else if (false && (state === 'STOP_BIT')) { // STOP_BIT is handled in DATA state
                    addressBits = [];
                    dataBits = [];
                    restartBit = false;
                    startBit = false;                    
                    readBit = false;
                    stopBit = true;
                    decodeI2CData();
                    nextState = 'IDLE';
                } else if (false && (state === 'RESTART_BIT')) { // RESTART_BIT is handled in DATA state
                    addressBits = [];
                    dataBits = [];
                    restartBit = true;
                    startBit = false;                    
                    readBit = false;
                    stopBit = false;
                    decodeI2CData();
                    nextState = 'DATA';
                }

                prevState = state;
                state = nextState;

                if ((trs_sda.sample_index < trs_scl.sample_index) || (true == is_last_scl_trs)) {
                    last_trs_sda = trs_sda;
                    trs_sda = ScanaStudio.trs_get_next(ch_sda);
                }
                else {
                    last_trs_scl = trs_scl;
                    trs_scl = ScanaStudio.trs_get_next(ch_scl);
                }

            break;

            case 2:
                return;
            break;
        }
        
        continue;
    }
}

/*
  Helper function to find a signal glitches on the data or clock lines
*/
function check_signal_noise (tr1, tr2)
{
    if (en_noise_flter)
    {
        var min_width_s = 200e-9    // Filter everything shorter than 200 ns (5 Mhz)
        var impulsion_width_s = (Math.abs(tr1.sample_index - tr2.sample_index) * (1 / sampling_rate));

        if (impulsion_width_s <= min_width_s)
        {
            return true;
        }
    }

    return false;
}


function add_sample_points()
{
    var s;

    for (s = 0; s < i2c_sample_points.length; s++)
    {
        var sp = i2c_sample_points[s];
        ScanaStudio.dec_item_add_sample_point(sp, "P");
        if (debug & DEBUG.DECOR) ScanaStudio.console_info_msg("add_sample_points() : P[" + s + "]", sp);
    }
}

/*
  Helper function to convert data to formated text
  according to formating options set by the user
*/
function format_content (data, data_format, size_bits)
{
    switch (data_format)
    {
        case 0: //HEX
        return "0x" + pad(data.toString(16), Math.ceil(size_bits/4));
        break;

        case 1: //Binary
        return to_binary_str(data,size_bits);
        break;

        case 2: // Dec
        return data.toString(10);
        break;

        case 3: //ASCII
        return " '" + String.fromCharCode(data) + "'"
        break;

        default: break;
    }
}

/* Helper fonction to convert value to binary, including 0-padding
  and groupping by 4-bits packets
*/
function to_binary_str (value, size)
{
  var i;
  var str = pad(value.toString(2),size);
  var ret = "";

  for (i = 0; i < str.length; i+= 4)
  {
    ret += str.slice(i,(i+4)) + " ";
  }

  ret = "0b" + ret + str.slice(i);
  return ret;
}

/*  A helper function add leading "0"s to numbers
      Parameters
        * num_str: A string of the number to be be 0-padded
        * size: The total wanted size of the output string
*/
function pad (num_str, size)
{
    while (num_str.length < size) num_str = "0" + num_str;
    return num_str;
}

function update_packet_view()
{
    if (i2c_packet_arr.length > 0)
    {
        var title_color = "";

        for (i = 0; i < i2c_packet_arr.length; i++)
        {
            if (i2c_packet_arr[i].root)
            {
                var packet = [];
                var data_cnt = 0;
                var addr = "";
                var op = "";

                for (i = 0; i < i2c_packet_arr.length; i++)
                {
                     if ((i > 0) && i2c_packet_arr[i].root)
                     {
                        break;
                     }
                     else
                     {
                        packet.push(i2c_packet_arr[i]);
                     }
                }

                if (packet.length > 0)
                {
                    for (i = 0; i < packet.length; i++)
                    {
                        if (packet[i].title.indexOf("Data") != -1)
                        {
                            data_cnt++;
                        }

                        if (packet[i].title.indexOf("Address") != -1)
                        {
                            addr = packet[i].extra_data;

                            if (packet[i].content.indexOf("Write") != -1)
                            {
                                op += "W";
                            }
                            else if (packet[i].content.indexOf("Read") != -1)
                            {
                                op += "R";
                            }
                        }
                    }

                    if (addr.length > 0)
                    {
                        packet[0].title += " " + addr;
                    }

                    if (op.length > 0)
                    {
                        packet[0].title += " " + op;
                    }

                    if (data_cnt > 0)
                    {
                        packet[0].title += "[" + data_cnt + "]";
                    }

                    for (i = 0; i < packet.length; i++)
                    {
                        title_color = i2c_packet_arr[i].title_color;

                        if (i2c_packet_arr[i].root != false)
                        {
                            title_color = ScanaStudio.PacketColors.Error.Title;

                            for (k = i; k < i2c_packet_arr.length; k++)
                            {
                                if (i2c_packet_arr[k].title.indexOf("Addr Ack") != -1)
                                {
                                    title_color = ScanaStudio.get_channel_color(ch_sda);
                                }
                            }
                        }

                        if (packet[i].title.indexOf("Data") != -1)
                        {
                            packet[i].title = packet[i].title + "[" + (data_cnt++) + "]"

                            ScanaStudio.packet_view_add_packet(packet[i].root, ch_sda, packet[i].st_sample, packet[i].end_sample,
                                                               packet[i].title, packet[i].content, title_color, packet[i].content_color);
                        }
                        else if (packet[i].title.indexOf("Ack") == -1) // Omit acknowledge to be more lapidary
                        {
                            data_cnt = 0;
                            ScanaStudio.packet_view_add_packet(packet[i].root, ch_sda, packet[i].st_sample, packet[i].end_sample,
                                                               packet[i].title, packet[i].content, title_color, packet[i].content_color);
                        }
                    }
                }
            }
        }

        i2c_packet_arr = [];
    }
}

//Trigger sequence GUI
function on_draw_gui_trigger()
{
    ScanaStudio.gui_add_new_selectable_containers_group("trig_alt","Select trigger type");
        ScanaStudio.gui_add_new_container("Trigger on any frame", false);
            ScanaStudio.gui_add_info_label("Trigger on any I2C Frame.");
            ScanaStudio.gui_add_combo_box("trig_any_frame","Trigger on:")
                ScanaStudio.gui_add_item_to_combo_box("Valid start condition", true);
                ScanaStudio.gui_add_item_to_combo_box("Valid stop condition", false);
                ScanaStudio.gui_add_item_to_combo_box("Any unacknowledged address", false);
                ScanaStudio.gui_add_item_to_combo_box("Any acknowledged address", false);
        ScanaStudio.gui_end_container();
        ScanaStudio.gui_add_new_container("on I2C address", true);
            ScanaStudio.gui_add_info_label("Type Decimal value (65) or HEX value (0x41). Address is a 7 bit field.");
            ScanaStudio.gui_add_text_input("trig_addr","Slave address","");
            ScanaStudio.gui_add_combo_box("trig_access_type","Access type");
                ScanaStudio.gui_add_item_to_combo_box("Any (read or write)", true);
                ScanaStudio.gui_add_item_to_combo_box("Read", false);
                ScanaStudio.gui_add_item_to_combo_box("Write", false);
            ScanaStudio.gui_add_check_box("trig_chk_ack","Address must be acknowledged by a slave", false);
        ScanaStudio.gui_end_container();
    ScanaStudio.gui_end_selectable_containers_group();
}

var trig_alt;
var trig_addr;
var trig_any_frame;
var trig_access_type
var trig_chk_ack;

function on_eval_gui_trigger()
{
    trig_alt = Number(ScanaStudio.gui_get_value("trig_alt"));
    trig_addr = Number(ScanaStudio.gui_get_value("trig_addr"));

    if (trig_alt == 1)
    {
        if (trig_addr.length == 0)
        {
            return "Please specify trigger byte.";
        }
        else if (isNaN(trig_addr))
        {
            return "Please enter a correct trigger address.";
        }
    }
    return "";
}

function on_build_trigger()
{
    reload_dec_gui_values();
    trig_alt = Number(ScanaStudio.gui_get_value("trig_alt"));
    trig_addr = Number(ScanaStudio.gui_get_value("trig_addr"));
    trig_any_frame = Number(ScanaStudio.gui_get_value("trig_any_frame"));
    trig_access_type = Number(ScanaStudio.gui_get_value("trig_access_type"));
    trig_chk_ack = Number(ScanaStudio.gui_get_value("trig_chk_ack"));

    if (trig_alt == 0) //Trig on any frame
    {
        switch(trig_any_frame)
        {
            case 0://Valid start condition
            {
                trig_build_start();
                break;
            }
            case 1://Valid stop condition
            {
                trig_build_stop();
                break;
            }
            case 2://Any unacknowledged address
            {
                trig_build_start();
                for(var i=0; i<8; i++)
                {
                    trig_build_bit(-1);
                }
                trig_build_ack(false);
                // trig_build_stop();
                break;
            }
            case 3://Any acknowledged address
            {
                trig_build_start();
                for(var i=0; i<8; i++)
                {
                    trig_build_bit(-1);
                }
                trig_build_ack(true);
                // trig_build_stop();
                break;
            }
            default:
            break;
        }
    }
    else if (trig_alt == 1) //Trig on I2C addresses
    {
        trig_build_start();
        for(var i=0; i<7; i++)
        {
            trig_build_bit(trig_addr>>(6-i) & 0x01);
        }

        switch(trig_access_type)
        {
            case 0://any (read or write)
            {
                trig_build_bit(-1);
                break;
            }
            case 1://Read
            {
                trig_build_bit(1);
                break;
            }
            case 2:
            {
                trig_build_bit(0);
                break;
            }
            default:
            {
                break;
            }
        }

        if(trig_chk_ack)
        {
            trig_build_ack(true);
        }
    }
    else
    {
        ScanaStudio.console_info_msg("error");
    }
}

function trig_build_start()
{
    var step = "";
    var return_nbr_step = 0;

    for (var i = 0; i < ScanaStudio.get_device_channels_count(); i++)
    {
        if (i == ch_sda)
        {
            step = "F" + step;
        }
        else if (i == ch_scl)
        {
            step = "1" + step;
        }
        else
        {
            step = "X" + step;
        }
    }

    ScanaStudio.flexitrig_append(step,-1, -1);
    return_nbr_step++;

    return return_nbr_step;
}

function trig_build_bit(bit)
{
    var step = "";
    var return_nbr_step = 0;

    for (var i = 0; i < ScanaStudio.get_device_channels_count(); i++)
    {
        if (i == ch_scl)
        {
            step = "R" + step;
        }
        else if (i == ch_sda)
        {
            if(bit == 1)
            {
                step = "1" + step;
            }
            else if (bit == 0)
            {
                step = "0" + step;
            }
            else
            {
                step = "X" + step;
            }
        }
        else
        {
            step = "X" + step;
        }
    }

    ScanaStudio.flexitrig_append(step,-1, -1);
    return_nbr_step++;

    step = "";
    for (var i = 0; i < ScanaStudio.get_device_channels_count(); i++)
    {
        if (i == ch_scl)
        {
            step = "F" + step;
        }
        else if (i == ch_sda)
        {
            if( bit == 1 )
            {
                step = "1" + step;
            }
            else if (bit == 0)
            {
                step = "0" + step;
            }
            else
            {
                step = "X" + step;
            }
        }
        else
        {
            step = "X" + step;
        }
    }

    ScanaStudio.flexitrig_append(step,-1, -1);
    return_nbr_step++;

    return return_nbr_step;
}

function trig_build_ack(ack)
{
    var return_nbr_step = 0;

    if(ack) //ACK
    {
        return_nbr_step += trig_build_bit(0);
    }
    else //NACK
    {
        return_nbr_step += trig_build_bit(1);
    }

    return return_nbr_step;
}

function trig_build_stop()
{
    var step = "";
    var return_nbr_step = 0;

    for (var i = 0; i < ScanaStudio.get_device_channels_count(); i++)
    {
        if (i == ch_sda)
        {
            step = "R" + step;
        }
        else if (i == ch_scl)
        {
            step = "1" + step;
        }
        else
        {
            step = "X" + step;
        }
    }

    ScanaStudio.flexitrig_append(step,-1, -1);
    return_nbr_step++;

    return return_nbr_step;
}

//Function called to generate demo siganls (when no physical device is attached)
function on_build_demo_signals()
{
    //Use the function below to get the number of samples to be built
    var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
    var i2c_builder = ScanaStudio.BuilderObject;
    var sample_rate = ScanaStudio.builder_get_sample_rate();
    ch_sda = ScanaStudio.gui_get_value("ch_sda");
    ch_scl = ScanaStudio.gui_get_value("ch_scl");
    i2c_f = ScanaStudio.builder_get_sample_rate()/100;
    var silence_period = (samples_to_build / (125));

    if (i2c_f < 1) i2c_f = 1;
    if (i2c_f > 100e3) i2c_f = 100e3;

    i2c_builder.config(ch_scl,ch_sda,i2c_f);
    i2c_builder.put_silence(silence_period);

    i2c_builder.put_start();
    i2c_builder.put_byte(0xF7,0); //10b address
    i2c_builder.put_byte(0xFF,0);
    i2c_builder.put_byte(0x55,1);
    i2c_builder.put_stop();
    i2c_builder.put_silence(silence_period);

    i2c_builder.put_start();
    i2c_builder.put_byte(0x00,0); //General call address
    i2c_builder.put_byte(0xA1,0);
    i2c_builder.put_byte(0x55,1);
    i2c_builder.put_stop();
    i2c_builder.put_silence(silence_period);

    i2c_builder.put_start();
    i2c_builder.put_byte(0x01,0); //Star byte call address
    i2c_builder.put_start();
    i2c_builder.put_byte(0xA1,0);
    i2c_builder.put_byte(0x55,1);
    i2c_builder.put_stop();
    i2c_builder.put_silence(silence_period);

    i2c_builder.put_start();
    i2c_builder.put_byte(0x08,0); //HS mode
    i2c_builder.put_start();
    i2c_builder.put_byte(0xA1,0);
    i2c_builder.put_byte(0x55,1);
    i2c_builder.put_stop();
    i2c_builder.put_silence(silence_period);

    i2c_builder.put_start();
    i2c_builder.put_byte(0x07,0); //RFU
    i2c_builder.put_byte(0xA1,0);
    i2c_builder.put_byte(0x55,1);
    i2c_builder.put_stop();
    i2c_builder.put_silence(silence_period);

    while (ScanaStudio.builder_get_samples_acc(ch_scl) < samples_to_build)
    {
        i2c_builder.put_silence(silence_period);
        i2c_builder.put_start();
        var random_size = Math.floor(Math.random() * 10) + 1;
        var w;

        for (w = 0; w < random_size; w++)
        {
            random_data = Math.round(Math.random() * 256);

            if (w == random_size-1)
            {
                ack = 1;
            }
            else
            {
                ack = 0;
            }

            i2c_builder.put_byte(random_data,ack);
        }

        i2c_builder.put_stop();
    }
}

//Builder object that can be shared to other scripts
ScanaStudio.BuilderObject =
{
    put_silence : function(s)
    {
        ScanaStudio.builder_add_samples(this.ch_scl,this.last_scl,s);
        ScanaStudio.builder_add_samples(this.ch_sda,this.last_sda,s);
    },

    put_start : function()
    {
        if (this.last_sda !=1)
        {
          this.last_scl = 0;
          ScanaStudio.builder_add_samples(this.ch_scl,this.last_scl,this.samples_per_quarter_clock);
          ScanaStudio.builder_add_samples(this.ch_sda,this.last_sda,this.samples_per_quarter_clock);
          this.last_sda = 1;
          ScanaStudio.builder_add_samples(this.ch_scl,this.last_scl,this.samples_per_quarter_clock);
          ScanaStudio.builder_add_samples(this.ch_sda,this.last_sda,this.samples_per_quarter_clock);
          this.last_scl = 1;
          this.last_sda = 1;
          ScanaStudio.builder_add_samples(this.ch_scl,this.last_scl,this.samples_per_quarter_clock);
          ScanaStudio.builder_add_samples(this.ch_sda,this.last_sda,this.samples_per_quarter_clock);
        }

        this.last_sda = 0;
        ScanaStudio.builder_add_samples(this.ch_scl,this.last_scl,this.samples_per_quarter_clock);
        ScanaStudio.builder_add_samples(this.ch_sda,this.last_sda,this.samples_per_quarter_clock);
    },

    put_stop : function()
    {
        if (this.last_sda != 0)
        {
            this.last_scl = 0;
            ScanaStudio.builder_add_samples(this.ch_scl,this.last_scl,this.samples_per_quarter_clock);
            ScanaStudio.builder_add_samples(this.ch_sda,this.last_sda,this.samples_per_quarter_clock);
            this.last_sda = 0;
            ScanaStudio.builder_add_samples(this.ch_scl,this.last_scl,this.samples_per_quarter_clock);
            ScanaStudio.builder_add_samples(this.ch_sda,this.last_sda,this.samples_per_quarter_clock);
            this.last_scl = 1;
            this.last_sda = 0;
            ScanaStudio.builder_add_samples(this.ch_scl,this.last_scl,this.samples_per_quarter_clock);
            ScanaStudio.builder_add_samples(this.ch_sda,this.last_sda,this.samples_per_quarter_clock);
        }

        this.last_sda = 1;
        ScanaStudio.builder_add_samples(this.ch_scl,this.last_scl,this.samples_per_quarter_clock);
        ScanaStudio.builder_add_samples(this.ch_sda,this.last_sda,this.samples_per_quarter_clock);
    },

    put_byte : function (byte, ack)
    {
        var b = 0;

        for (b = 7; b >= 0; b--)
        {
            this.put_bit((byte >> b) & 0x1);
        }

        this.put_bit(ack);
    },

    put_bit : function (b)
    {
        ScanaStudio.builder_add_samples(this.ch_scl,0,this.samples_per_quarter_clock);
        ScanaStudio.builder_add_samples(this.ch_sda,this.last_sda,this.samples_per_quarter_clock);

        this.last_sda = b;
        ScanaStudio.builder_add_samples(this.ch_scl,0,this.samples_per_quarter_clock);
        ScanaStudio.builder_add_samples(this.ch_sda,this.last_sda,this.samples_per_quarter_clock);

        ScanaStudio.builder_add_samples(this.ch_scl,1,this.samples_per_quarter_clock);
        ScanaStudio.builder_add_samples(this.ch_sda,this.last_sda,this.samples_per_quarter_clock);

        ScanaStudio.builder_add_samples(this.ch_scl,1,this.samples_per_quarter_clock);
        ScanaStudio.builder_add_samples(this.ch_sda,this.last_sda,this.samples_per_quarter_clock);
    },

    config : function(ch_scl,ch_sda,frequency)
    {
        this.ch_sda = ch_sda;
        this.ch_scl = ch_scl;
        this.last_sda = 1;
        this.last_scl = 1;
        this.samples_per_quarter_clock = ScanaStudio.builder_get_sample_rate() / (frequency * 4);
    }
};
