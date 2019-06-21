/* Protocol meta info:
<NAME> MODBUS </NAME>
<DESCRIPTION>

</DESCRIPTION>
<VERSION> 0.0 </VERSION>
<AUTHOR_NAME>  Nicolas BASTIT </AUTHOR_NAME>
<AUTHOR_URL> n.bastit@ikalogic.com </AUTHOR_URL>
<COPYRIGHT> Copyright Nicolas BASTIT </COPYRIGHT>
<LICENSE>  This code is distributed under the terms
of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.0:  Initial release.
</RELEASE_NOTES>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki/UART-ScanaStudio-script-documentation </HELP_URL>
*/


function on_draw_gui_decoder()
{
    ScanaStudio.gui_add_ch_selector("ch","Channel to decode","MODBUS");

    ScanaStudio.gui_add_baud_selector("baud","BAUD rate",9600);

    ScanaStudio.gui_add_combo_box("mode","MODBUS mode");
        ScanaStudio.gui_add_item_to_combo_box("RTU transmissioin Mode (default)",true);
        ScanaStudio.gui_add_item_to_combo_box("ASCII transmissioin Mode",false);

    ScanaStudio.gui_add_new_tab("Advanced options",false);

        ScanaStudio.gui_add_combo_box("parity","Parity bit")
            ScanaStudio.gui_add_item_to_combo_box( "No parity bit (usualy 2 stop bits required)", false );
            ScanaStudio.gui_add_item_to_combo_box( "Odd parity bit", false );
            ScanaStudio.gui_add_item_to_combo_box( "Even parity bit (default)", true );

      	ScanaStudio.gui_add_combo_box( "stop", "Stop bits bit" );
      		ScanaStudio.gui_add_item_to_combo_box( "1 stop bit (default)", true );
      		ScanaStudio.gui_add_item_to_combo_box( "1.5 stop bits", false );
      		ScanaStudio.gui_add_item_to_combo_box( "2 stop bits", false );

      	ScanaStudio.gui_add_combo_box( "invert", "Inverted logic" );
      		ScanaStudio.gui_add_item_to_combo_box( "Non inverted logic (default)", true );
      		ScanaStudio.gui_add_item_to_combo_box( "Inverted logic: All signals inverted", false );

      	ScanaStudio.gui_add_combo_box( "order", "Select bit order" );
      		ScanaStudio.gui_add_item_to_combo_box( "Least Significant bit (LSB) (default)", true );
      		ScanaStudio.gui_add_item_to_combo_box( "Most Significant bit (MSB)", false );

    ScanaStudio.gui_end_tab();

    //Add hidden elements for the UART decoder
    ScanaStudio.gui_add_hidden_field("nbits",3);
    ScanaStudio.gui_add_hidden_field("format_hex","false");
    ScanaStudio.gui_add_hidden_field("format_ascii","false");
    ScanaStudio.gui_add_hidden_field("format_dec","false");
    ScanaStudio.gui_add_hidden_field("format_bin","false");
}

var channel,baud,mode,parity,stop,invert,order;
var state_machine;
var trs;
var trame = [];
var current_fct;
var current_i_fct;
var current_byte_cnt;
var current_i_crc;
var current_i_eof;
var too_short_silent;
var i;
var need_reinit_state_machine;


function reload_dec_gui_values()
{
    // read GUI values using ScanaStudio.gui_get_value("ID");
    channel =  Number(ScanaStudio.gui_get_value("ch"));
    baud = Number(ScanaStudio.gui_get_value("baud"));
    mode = Number(ScanaStudio.gui_get_value("mode"));
    //nbits's 0 value corresponds to 5 bits per transfer
    if(mode == 0)
    {
        ScanaStudio.gui_set_hidden_field("nbits",3);
        ScanaStudio.gui_set_hidden_field("format_hex","true");
        ScanaStudio.gui_set_hidden_field("format_ascii","false");
        ScanaStudio.gui_set_hidden_field("format_dec","false");
        ScanaStudio.gui_set_hidden_field("format_bin","false");
    }
    else
    {
        ScanaStudio.gui_set_hidden_field("nbits",2);
        ScanaStudio.gui_set_hidden_field("format_hex","false");
        ScanaStudio.gui_set_hidden_field("format_ascii","true");
        ScanaStudio.gui_set_hidden_field("format_dec","false");
        ScanaStudio.gui_set_hidden_field("format_bin","false");
    }
    parity = Number(ScanaStudio.gui_get_value("parity"));
    //Stop value is 1, 1.5 or 2)
    stop = (Number(ScanaStudio.gui_get_value("stop"))*0.5) + 1;
    order =  Number(ScanaStudio.gui_get_value("order"));
    invert = Number(ScanaStudio.gui_get_value("invert"));
}


function on_eval_gui_decoder()
{
    ScanaStudio.console_info_msg(Number(ScanaStudio.gui_get_value("baud")*8) + " " + (ScanaStudio.get_capture_sample_rate()));
    if(Number(ScanaStudio.gui_get_value("baud")*8) >= (ScanaStudio.get_capture_sample_rate()) )
    {
        return "Selected bauderate is too high compared to the sampling rate you chose. Bauderate should be at least 8 times lower than the sampling rate.";
    }

    if(Number(ScanaStudio.gui_get_value("baud")) == 0)
    {
        return "Selected bauderate can't be null.";
    }

    ScanaStudio.set_script_instance_name("MODBUS on CH"+(ScanaStudio.gui_get_value("ch")+1).toString());
    return "";
}



const   ENUM_STATE_SOF = 0,
        ENUM_STATE_SLAVE_ADDR = 1,
        ENUM_STATE_FUNCTION = 2,
        ENUM_STATE_AFTER_FUNCTION = 3,
        ENUM_STATE_CRC = 4,
        ENUM_STATE_LRC = 5,
        ENUM_STATE_UNDEFINED = 10,



//list of functions code
        FCT_READ_COIL_STATUS = 0x01,
        FCT_READ_INPUT_STATUS = 0x02,
        FCT_READ_HOLDING_REGISTERS = 0x03,
        FCT_READ_INPUT_REGISTERS = 0x04,
        FCT_WRITE_SINGLE_COIL = 0x05,
        FCT_WRITE_SINGLE_REGISTER = 0x06,
        FCT_WRITE_MULTIPLE_COILS = 0x0F,
        FCT_WRITE_MULTIPLE_REGISTERS = 0x10,

//list of exception codes
        ERROR_ILLEGAL_FUNCTION = 0x01,
        ERROR_ILLEGAL_DATA_ADDRESS = 0x02,
        ERROR_ILLEGAL_DATA_VALUE = 0x03,
        ERROR_SERVER_DEVICE_FAILURE = 0x04,
        ERROR_ACKNOWLEDGE = 0x05,
        ERROR_SERVER_DEVICE_BUSY = 0x06,
        ERROR_MEMORY_PARITY_ERROR = 0x08,
        ERROR_GATEWAY_PATH_UNAVAILABLE = 0x0A,
        ERROR_GATEWAY_TARGET_DEVICE_FAILED_TO_RESPOND = 0x0B;


const   COLOR_T_ADDR    = "#FF9966",
        COLOR_T_FCT     = "#FF66CC",
        COLOR_T_DATA    = "#33FFFF",
        COLOR_T_CRC     = "#33FF66",
        COLOR_T_ERROR   = "#FF0000",
        COLOR_C_ADDR    = "#FFCC66",
        COLOR_C_FCT     = "#FF99CC",
        COLOR_C_DATA    = "#99FFFF",
        COLOR_C_CRC     = "#66FF99",
        COLOR_C_ERROR   = "#FF8080";



function on_decode_signals_RTU_mode(uart_items)
{
    // Remove any element that do not contain data, e.g.: Start, Stop, parity
    var j=0;
    for (j = uart_items.length - 1; j >= 0; j--)
    {
        if( (uart_items[j].content == "Start") ||
            (uart_items[j].content == "Parity OK") ||
            (uart_items[j].content == "Parity ERROR") ||
            (uart_items[j].content == "Stop") ||
            (uart_items[j].content == "Stop bit Missing!") )
        {
            uart_items.splice(j,1);
        }
    }

    var sample_per_bits = ScanaStudio.get_capture_sample_rate() / baud;

    for(i=0; (i<uart_items.length)&&(!ScanaStudio.abort_is_requested()); i++)
    {
        if(i>=1)//this silence time reinit state_machine
        {
            if( (uart_items[i].start_sample_index - 1*sample_per_bits - 1.5*11*sample_per_bits) >= (uart_items[i-1].end_sample_index + 2*sample_per_bits) )
            {
                if((state_machine == ENUM_STATE_AFTER_FUNCTION)&&(current_byte_cnt!=-1))
                {
                    switch(current_fct)
                    {
                        case FCT_READ_COIL_STATUS:
                        case FCT_READ_INPUT_STATUS:
                        case FCT_READ_HOLDING_REGISTERS:
                        case FCT_READ_INPUT_REGISTERS:
                            {
                                if(current_i_eof == -1)
                                {
                                    current_i_eof = i;
                                }

                                if((current_i_eof-current_i_fct-2 == 5) && (current_i_eof != -1) && (current_byte_cnt != 3))
                                {
                                    i = current_i_fct + 5;
                                    current_byte_cnt = -1;
                                }
                                else if((current_i_eof != -1) && !need_reinit_state_machine)
                                {
                                    need_reinit_state_machine = true;
                                    i = current_i_fct +1;
                                }
                                else
                                {
                                    i = current_i_fct ;
                                    state_machine = ENUM_STATE_UNDEFINED;
                                    break;
                                }
                                state_machine = ENUM_STATE_AFTER_FUNCTION;
                                break;
                            }
                        case FCT_WRITE_MULTIPLE_COILS:
                        case FCT_WRITE_MULTIPLE_REGISTERS:
                            {
                                i = current_i_fct + 5;
                                current_byte_cnt = -2;
                                state_machine = ENUM_STATE_AFTER_FUNCTION;
                                break;
                            }
                        default:
                            {
                                if(current_i_eof == -1)
                                {
                                    current_i_eof = i;
                                    i = current_i_fct + 1;
                                }
                                state_machine = ENUM_STATE_AFTER_FUNCTION;
                                break;
                            }
                    }
                }
                else
                {
                    state_machine = ENUM_STATE_SOF;
                }
            }
        }

        switch(state_machine)
        {
            case ENUM_STATE_SOF: //SOF needs 3.5 char of silents, usualy, 1 char is 11 bits
            {
                trs = ScanaStudio.trs_get_before(channel, uart_items[i].start_sample_index - 1.5*sample_per_bits);
                trame = [];
                current_fct = -1;
                current_i_fct = -1;
                current_byte_cnt = -1;
                current_i_crc = -1;
                current_i_eof = -1;
                need_reinit_state_machine = false;

                if(uart_items[i].start_sample_index - trs.sample_index > 3.5*11*sample_per_bits)//normal silence
                {// SOF detected
                    ScanaStudio.dec_item_new( channel,
                                            uart_items[i].start_sample_index - 3.5*11*sample_per_bits - 1.5*sample_per_bits,
                                            uart_items[i].start_sample_index - 1.5*sample_per_bits);
                    ScanaStudio.dec_item_add_content( "Start Of Frame" );
                    ScanaStudio.dec_item_add_content( "SOF" );

                    state_machine = ENUM_STATE_SLAVE_ADDR;
                }
                else if(uart_items[i].start_sample_index - trs.sample_index > 1.5*11*sample_per_bits)//minimum silence for end of frame
                {
                    if(uart_items[i-1].end_sample_index > trs.sample_index)
                    {
                        trs.sample_index = uart_items[i-1].end_sample_index + 1.5*sample_per_bits;
                    }

                    ScanaStudio.packet_view_add_packet( true,
                                                        channel,
                                                        trs.sample_index,
                                                        uart_items[i].start_sample_index - 1.5*sample_per_bits,
                                                        "SOF Warning",
                                                        "Too short silence",
                                                        COLOR_T_ERROR,
                                                        COLOR_C_ERROR);

                    ScanaStudio.dec_item_new( channel,
                                            trs.sample_index,
                                            uart_items[i].start_sample_index - 1.5*sample_per_bits);
                    ScanaStudio.dec_item_add_content( "Start Of Frame Warning" );
                    ScanaStudio.dec_item_add_content( "!SOF" );
                    ScanaStudio.dec_item_emphasize_warning();

                    state_machine = ENUM_STATE_SLAVE_ADDR;
                }
                else
                {
                    if(too_short_silent == false)
                    {
                        if(i>=1)
                        {
                            if(uart_items[i-1].end_sample_index > trs.sample_index)
                            {
                                trs.sample_index = uart_items[i-1].end_sample_index + 1.5*sample_per_bits;
                            }
                        }
                        else
                        {
                            trs.sample_index = 0;
                        }
                        too_short_silent = true;
                        ScanaStudio.packet_view_add_packet( true,
                                                            channel,
                                                            trs.sample_index,
                                                            uart_items[i].start_sample_index,
                                                            "SOF Error",
                                                            "Way too short silence !",
                                                            COLOR_T_ERROR,
                                                            COLOR_T_ERROR);

                        ScanaStudio.dec_item_new( channel,
                                                trs.sample_index,
                                                uart_items[i].start_sample_index - 1.5*sample_per_bits);
                        ScanaStudio.dec_item_add_content( "ERROR !!! Start of Frame unrecognized" );
                        ScanaStudio.dec_item_add_content( "! !SOF !" );
                        ScanaStudio.dec_item_emphasize_error();
                        state_machine = ENUM_STATE_SLAVE_ADDR;
                    }
                    else
                    {
                        break;
                    }
                }
            }//end ENUM_STATE_SOF

            case ENUM_STATE_SLAVE_ADDR:
            {
                ScanaStudio.dec_item_new( channel,
                                        uart_items[i].start_sample_index,
                                        uart_items[i].end_sample_index);
                ScanaStudio.dec_item_add_content( "Slave Address : " + uart_items[i].content );
                ScanaStudio.dec_item_add_content( "Slave Addr: " + uart_items[i].content );
                ScanaStudio.dec_item_add_content( "Addr:" + uart_items[i].content );
                ScanaStudio.dec_item_add_content( uart_items[i].content );
                ScanaStudio.packet_view_add_packet( true,
                                                    channel,
                                                    uart_items[i].start_sample_index,
                                                    uart_items[i].end_sample_index,
                                                    "Modbus",
                                                    "CH" + (channel + 1),
                                                    "#0000FF",
                                                    "#8080FF");
                ScanaStudio.packet_view_add_packet( false,
                                                    channel,
                                                    uart_items[i].start_sample_index,
                                                    uart_items[i].end_sample_index,
                                                    "Slave Addr:",
                                                    "@" + uart_items[i].content,
                                                    COLOR_T_ADDR,
                                                    COLOR_C_ADDR);

                trame.push(Number(uart_items[i].content));
                too_short_silent = false;
                state_machine = ENUM_STATE_FUNCTION;
                break;
            }

            case ENUM_STATE_FUNCTION:
            {
                current_fct = Number( uart_items[i].content );
                current_i_fct = i;
                current_byte_cnt = -1;
                current_i_eof = -1;
                current_i_crc = -1;

                state_machine = ENUM_STATE_AFTER_FUNCTION;
                break;
            }

            case ENUM_STATE_AFTER_FUNCTION:
            {
                switch(current_fct)
                {
                    case FCT_READ_COIL_STATUS:
                    case FCT_READ_INPUT_STATUS:
                    case FCT_READ_HOLDING_REGISTERS:
                    case FCT_READ_INPUT_REGISTERS:
                    {
                        if( (current_byte_cnt == -1) && (i == current_i_fct + 1) )
                        {
                            current_byte_cnt = Number(uart_items[i].content);
                            break;
                        }
                        else if( (i-current_i_fct == 5) && (current_byte_cnt == -1) )//request
                        {
                            ScanaStudio.dec_item_new( channel,
                                                    uart_items[current_i_fct].start_sample_index,
                                                    uart_items[current_i_fct].end_sample_index);
                            ScanaStudio.dec_item_add_content( "Function : " + function_to_str(current_fct,1) );
                            ScanaStudio.dec_item_add_content( "Fct : " + function_to_str(current_fct,1) );
                            ScanaStudio.dec_item_add_content( "Fct : " + uart_items[current_i_fct].content );
                            ScanaStudio.dec_item_add_content( uart_items[current_i_fct].content );
                            ScanaStudio.packet_view_add_packet( false,
                                                                channel,
                                                                uart_items[current_i_fct].start_sample_index,
                                                                uart_items[current_i_fct].end_sample_index,
                                                                "Function",
                                                                function_to_str(current_fct,1),
                                                                COLOR_T_FCT,
                                                                COLOR_C_FCT);
                            trame.push(Number(uart_items[current_i_fct].content));

                            var k;
                            for(k=current_i_fct+1; k<i; k++)//navigate throught the reste of data
                            {
                                var pkt_str = "";
                                ScanaStudio.dec_item_new( channel,
                                                        uart_items[k].start_sample_index,
                                                        uart_items[k].end_sample_index);
                                switch(k - current_i_fct)
                                {
                                    case 1:
                                    {
                                        ScanaStudio.dec_item_add_content("Starting Address Hi : " + uart_items[k].content);
                                        ScanaStudio.dec_item_add_content("Hi : " + uart_items[k].content);
                                        pkt_str = "Starting @ Hi";
                                        break;
                                    }
                                    case 2:
                                    {
                                        ScanaStudio.dec_item_add_content("Starting Address Lo : " + uart_items[k].content);
                                        ScanaStudio.dec_item_add_content("Lo : " + uart_items[k].content);
                                        pkt_str = "Starting @ Lo";
                                        break;
                                    }
                                    case 3:
                                    {
                                        if(current_fct==FCT_READ_COIL_STATUS)
                                        {
                                            ScanaStudio.dec_item_add_content("Quantity of Coils Hi : " + uart_items[k].content);
                                            pkt_str = "Qty Coils @ Hi";
                                        }
                                        else if(current_fct==FCT_READ_INPUT_STATUS)
                                        {
                                            ScanaStudio.dec_item_add_content("Quantity of inputs Hi : " + uart_items[k].content);
                                            pkt_str = "Qty Input @ Hi";
                                        }
                                        else if( (current_fct==FCT_READ_HOLDING_REGISTERS) || (current_fct==FCT_READ_INPUT_REGISTERS) )
                                        {
                                            ScanaStudio.dec_item_add_content("Quantity of Register Hi : " + uart_items[k].content);
                                            pkt_str = "Qty Reg @ Hi";
                                        }
                                        ScanaStudio.dec_item_add_content("Hi : " + uart_items[k].content);
                                        break;
                                    }
                                    case 4:
                                    {
                                        if(current_fct==FCT_READ_COIL_STATUS)
                                        {
                                            ScanaStudio.dec_item_add_content("Quantity of Coils Lo : " + uart_items[k].content);
                                            pkt_str = "Qty Coils @ Lo";
                                        }
                                        else if(current_fct==FCT_READ_INPUT_STATUS)
                                        {
                                            ScanaStudio.dec_item_add_content("Quantity of inputs Lo : " + uart_items[k].content);
                                            pkt_str = "Qty Input @ Lo";
                                        }
                                        else if( (current_fct==FCT_READ_HOLDING_REGISTERS) || (current_fct==FCT_READ_INPUT_REGISTERS) )
                                        {
                                            ScanaStudio.dec_item_add_content("Quantity of Register Lo : " + uart_items[k].content);
                                            pkt_str = "Qty Reg @ Lo";
                                        }
                                        ScanaStudio.dec_item_add_content("Lo : " + uart_items[k].content);
                                        break;
                                    }
                                    default:
                                    {
                                        ScanaStudio.dec_item_add_content("Unknown item : " + uart_items[k].content);
                                        pkt_str = "...";
                                        break;
                                    }
                                }//end switch k
                                ScanaStudio.dec_item_add_content(uart_items[k].content);
                                ScanaStudio.packet_view_add_packet( false,
                                                                    channel,
                                                                    uart_items[k].start_sample_index,
                                                                    uart_items[k].end_sample_index,
                                                                    pkt_str,
                                                                    uart_items[k].content,
                                                                    COLOR_T_DATA,
                                                                    COLOR_C_DATA);
                                trame.push(Number(uart_items[k].content));
                            }//end for k
                            i--;
                            state_machine = ENUM_STATE_CRC;
                        }
                        else if( (current_byte_cnt != -1) && (i == current_i_fct + 1 + current_byte_cnt) && (current_i_eof!=-1) ) // answer
                        {
                            ScanaStudio.dec_item_new( channel,
                                                    uart_items[current_i_fct].start_sample_index,
                                                    uart_items[current_i_fct].end_sample_index);
                            ScanaStudio.dec_item_add_content( "Function : " + function_to_str(current_fct,0) );
                            ScanaStudio.dec_item_add_content( "Fct : " + function_to_str(current_fct,0) );
                            ScanaStudio.dec_item_add_content( "Fct : " + uart_items[current_i_fct].content );
                            ScanaStudio.dec_item_add_content( uart_items[current_i_fct].content );
                            ScanaStudio.packet_view_add_packet( false,
                                                                channel,
                                                                uart_items[current_i_fct].start_sample_index,
                                                                uart_items[current_i_fct].end_sample_index,
                                                                "Function",
                                                                function_to_str(current_fct,0),
                                                                COLOR_T_FCT,
                                                                COLOR_C_FCT);
                            trame.push(Number(uart_items[current_i_fct].content));

                            ScanaStudio.dec_item_new( channel,
                                                    uart_items[current_i_fct + 1].start_sample_index,
                                                    uart_items[current_i_fct + 1].end_sample_index);
                            ScanaStudio.dec_item_add_content( "Byte Count : " + uart_items[current_i_fct + 1].content );
                            ScanaStudio.dec_item_add_content( "Cnt : " + uart_items[current_i_fct + 1].content );
                            ScanaStudio.dec_item_add_content( uart_items[current_i_fct + 1].content );
                            ScanaStudio.packet_view_add_packet( false,
                                                                channel,
                                                                uart_items[current_i_fct + 1].start_sample_index,
                                                                uart_items[current_i_fct + 1].end_sample_index,
                                                                "Cnt",
                                                                uart_items[current_i_fct + 1].content,
                                                                COLOR_T_DATA,
                                                                COLOR_C_DATA);
                            trame.push(Number(uart_items[current_i_fct+1].content));

                            var k;
                            var pkt_str = "";
                            for(k=current_i_fct + 2; k < current_byte_cnt + current_i_fct + 2; k++)
                            {
                                ScanaStudio.dec_item_new( channel,
                                                        uart_items[k].start_sample_index,
                                                        uart_items[k].end_sample_index);

                                if( (current_fct==FCT_READ_COIL_STATUS) || (current_fct==FCT_READ_INPUT_STATUS) )
                                {
                                    ScanaStudio.dec_item_add_content( "Data : " + uart_items[k].content );
                                    pkt_str = "Data";
                                }
                                else if( (current_fct==FCT_READ_HOLDING_REGISTERS) || (current_fct==FCT_READ_INPUT_REGISTERS) )
                                {
                                    if( k%2 )
                                    {
                                        ScanaStudio.dec_item_add_content( "Data Lo: " + uart_items[k].content );
                                        ScanaStudio.dec_item_add_content("Lo : " + uart_items[k].content);
                                        pkt_str = "Data Lo";
                                    }
                                    else
                                    {
                                        ScanaStudio.dec_item_add_content( "Data Hi: " + uart_items[k].content );
                                        ScanaStudio.dec_item_add_content("Hi : " + uart_items[k].content);
                                        pkt_str = "Data Hi";
                                    }
                                }

                                ScanaStudio.dec_item_add_content( uart_items[k].content );
                                ScanaStudio.packet_view_add_packet( false,
                                                                    channel,
                                                                    uart_items[k].start_sample_index,
                                                                    uart_items[k].end_sample_index,
                                                                    pkt_str,
                                                                    uart_items[k].content,
                                                                    COLOR_T_DATA,
                                                                    COLOR_C_DATA);
                                trame.push(Number(uart_items[k].content));
                            }
                            state_machine = ENUM_STATE_CRC;
                        }
                        break;
                    }//end case FCT_READ_COIL_STATUS or FCT_READ_INPUT_STATUS or FCT_READ_HOLDING_REGISTERS or FCT_READ_INPUT_REGISTERS



                    case FCT_WRITE_SINGLE_COIL:
                    case FCT_WRITE_SINGLE_REGISTER:
                    {
                        if( i-current_i_fct == 5 )//request or answer
                        {
                            ScanaStudio.dec_item_new( channel,
                                                    uart_items[current_i_fct].start_sample_index,
                                                    uart_items[current_i_fct].end_sample_index);
                            ScanaStudio.dec_item_add_content( "Function : " + function_to_str(current_fct,1) );
                            ScanaStudio.dec_item_add_content( "Fct : " + function_to_str(current_fct,1) );
                            ScanaStudio.dec_item_add_content( "Fct : " + uart_items[current_i_fct].content );
                            ScanaStudio.dec_item_add_content( uart_items[current_i_fct].content );
                            ScanaStudio.packet_view_add_packet( false,
                                                                channel,
                                                                uart_items[current_i_fct].start_sample_index,
                                                                uart_items[current_i_fct].end_sample_index,
                                                                "Function",
                                                                function_to_str(current_fct,1),
                                                                COLOR_T_FCT,
                                                                COLOR_C_FCT);
                            trame.push(Number(uart_items[current_i_fct].content));

                            var k;
                            var pkt_str = "";
                            for(k=current_i_fct+1; k<i; k++)//navigate throught the reste of data
                            {
                                ScanaStudio.dec_item_new( channel,
                                                        uart_items[k].start_sample_index,
                                                        uart_items[k].end_sample_index);
                                switch(k - current_i_fct)
                                {
                                    case 1:
                                    {
                                        if(current_fct==FCT_WRITE_SINGLE_COIL)
                                        {
                                            ScanaStudio.dec_item_add_content("Coil Address Hi : " + uart_items[k].content);
                                            pkt_str = "Coil @ Hi";
                                        }
                                        else
                                        {
                                            ScanaStudio.dec_item_add_content("Register Address Hi : " + uart_items[k].content);
                                            pkt_str = "Reg @ Hi";
                                        }
                                        ScanaStudio.dec_item_add_content("Hi : " + uart_items[k].content);
                                        break;
                                    }
                                    case 2:
                                    {
                                        if(current_fct==FCT_WRITE_SINGLE_COIL)
                                        {
                                            ScanaStudio.dec_item_add_content("Coil Address Lo : " + uart_items[k].content);
                                            pkt_str = "Coil @ Lo";
                                        }
                                        else
                                        {
                                            ScanaStudio.dec_item_add_content("Register Address Lo : " + uart_items[k].content);
                                            pkt_str = "Reg @ Lo";
                                        }
                                        ScanaStudio.dec_item_add_content("Lo : " + uart_items[k].content);
                                        break;
                                    }
                                    case 3:
                                    {
                                        ScanaStudio.dec_item_add_content("Write Data Hi : " + uart_items[k].content);
                                        ScanaStudio.dec_item_add_content("Hi : " + uart_items[k].content);
                                        pkt_str = "W Data Hi";
                                        break;
                                    }
                                    case 4:
                                    {
                                        ScanaStudio.dec_item_add_content("Write Data Lo : " + uart_items[k].content);
                                        ScanaStudio.dec_item_add_content("Lo : " + uart_items[k].content);
                                        pkt_str = "W Data Lo";
                                        break;
                                    }
                                    default:
                                    {
                                        ScanaStudio.dec_item_add_content("Unknown item : " + uart_items[k].content);
                                        pkt_str = "...";
                                        break;
                                    }
                                }//end switch k
                                ScanaStudio.dec_item_add_content(uart_items[k].content);
                                ScanaStudio.packet_view_add_packet( false,
                                                                    channel,
                                                                    uart_items[k].start_sample_index,
                                                                    uart_items[k].end_sample_index,
                                                                    pkt_str,
                                                                    uart_items[k].content,
                                                                    COLOR_T_DATA,
                                                                    COLOR_C_DATA);
                                trame.push(Number(uart_items[k].content));
                            }//end for k
                            i--;
                            state_machine = ENUM_STATE_CRC;
                        }
                        break;
                    }//end case FCT_WRITE_SINGLE_COIL and FCT_WRITE_SINGLE_REGISTER



                    case FCT_WRITE_MULTIPLE_COILS:
                    case FCT_WRITE_MULTIPLE_REGISTERS:
                    {
                        if( (current_byte_cnt == -1) && (i == current_i_fct + 5) )
                        {
                            current_byte_cnt = Number(uart_items[i].content);
                            break;
                        }
                        else if( (i-current_i_fct == 5) && (current_byte_cnt == -2))//answer
                        {
                            ScanaStudio.dec_item_new( channel,
                                                    uart_items[current_i_fct].start_sample_index,
                                                    uart_items[current_i_fct].end_sample_index);
                            ScanaStudio.dec_item_add_content( "Function : " + function_to_str(current_fct,0) );
                            ScanaStudio.dec_item_add_content( "Fct : " + function_to_str(current_fct,0) );
                            ScanaStudio.dec_item_add_content( "Fct : " + uart_items[current_i_fct].content );
                            ScanaStudio.dec_item_add_content( uart_items[current_i_fct].content );
                            ScanaStudio.packet_view_add_packet( false,
                                                                channel,
                                                                uart_items[current_i_fct].start_sample_index,
                                                                uart_items[current_i_fct].end_sample_index,
                                                                "Function",
                                                                function_to_str(current_fct,0),
                                                                COLOR_T_FCT,
                                                                COLOR_C_FCT);
                            trame.push(Number(uart_items[current_i_fct].content));

                            var k;
                            var pkt_str = "";
                            for(k=current_i_fct+1; k<i; k++)//navigate throught the reste of data
                            {
                                ScanaStudio.dec_item_new( channel,
                                                        uart_items[k].start_sample_index,
                                                        uart_items[k].end_sample_index);
                                switch(k - current_i_fct)
                                {
                                    case 1:
                                    {
                                        if(current_fct==FCT_WRITE_MULTIPLE_COILS)
                                        {
                                            ScanaStudio.dec_item_add_content("Coil Address Hi : " + uart_items[k].content);
                                            pkt_str = "Coil @ Hi";
                                        }
                                        else
                                        {
                                            ScanaStudio.dec_item_add_content("Starting Address Hi : " + uart_items[k].content);
                                            pkt_str = "Start @ Hi";
                                        }
                                        ScanaStudio.dec_item_add_content("Hi : " + uart_items[k].content);
                                        break;
                                    }
                                    case 2:
                                    {
                                        if(current_fct==FCT_WRITE_MULTIPLE_COILS)
                                        {
                                            ScanaStudio.dec_item_add_content("Coil Address Lo : " + uart_items[k].content);
                                            pkt_str = "Coil @ Lo";
                                        }
                                        else
                                        {
                                            ScanaStudio.dec_item_add_content("Starting Address Lo : " + uart_items[k].content);
                                            pkt_str = "Start @ Lo";
                                        }
                                        ScanaStudio.dec_item_add_content("Lo : " + uart_items[k].content);
                                        break;
                                    }
                                    case 3:
                                    {
                                        if(current_fct==FCT_WRITE_MULTIPLE_COILS)
                                        {
                                            ScanaStudio.dec_item_add_content("Quantity of Coils Hi : " + uart_items[k].content);
                                            pkt_str = "Qty Coil Hi";
                                        }
                                        else
                                        {
                                            ScanaStudio.dec_item_add_content("Quantity of Registers Hi : " + uart_items[k].content);
                                            pkt_str = "Qty Reg Hi";
                                        }
                                        ScanaStudio.dec_item_add_content("Hi : " + uart_items[k].content);
                                        break;
                                    }
                                    case 4:
                                    {
                                        if(current_fct==FCT_WRITE_MULTIPLE_COILS)
                                        {
                                            ScanaStudio.dec_item_add_content("Quantity of Coils Lo : " + uart_items[k].content);
                                            pkt_str = "Qty Coil Lo";
                                        }
                                        else
                                        {
                                            ScanaStudio.dec_item_add_content("Quantity of Registers Lo : " + uart_items[k].content);
                                            pkt_str = "Qty Reg Lo";
                                        }
                                        ScanaStudio.dec_item_add_content("Lo : " + uart_items[k].content);
                                        break;
                                    }
                                    default:
                                    {
                                        ScanaStudio.dec_item_add_content("Unknown item : " + uart_items[k].content);
                                        pkt_str = "...";
                                        break;
                                    }
                                }//end switch k
                                ScanaStudio.dec_item_add_content(uart_items[k].content);
                                ScanaStudio.packet_view_add_packet( false,
                                                                    channel,
                                                                    uart_items[k].start_sample_index,
                                                                    uart_items[k].end_sample_index,
                                                                    pkt_str,
                                                                    uart_items[k].content,
                                                                    COLOR_T_DATA,
                                                                    COLOR_C_DATA);
                                trame.push(Number(uart_items[k].content));
                            }//end for k
                            i--;
                            state_machine = ENUM_STATE_CRC;
                        }
                        else if( (current_byte_cnt != -1) && (i == current_i_fct + 6 + current_byte_cnt) ) // request
                        {
                            ScanaStudio.dec_item_new( channel,
                                                    uart_items[current_i_fct].start_sample_index,
                                                    uart_items[current_i_fct].end_sample_index);
                            ScanaStudio.dec_item_add_content( "Function : " + function_to_str(current_fct,1) );
                            ScanaStudio.dec_item_add_content( "Fct : " + function_to_str(current_fct,1) );
                            ScanaStudio.dec_item_add_content( "Fct : " + uart_items[current_i_fct].content );
                            ScanaStudio.dec_item_add_content( uart_items[current_i_fct].content );
                            ScanaStudio.packet_view_add_packet( false,
                                                                channel,
                                                                uart_items[current_i_fct].start_sample_index,
                                                                uart_items[current_i_fct].end_sample_index,
                                                                "Function",
                                                                function_to_str(current_fct,1),
                                                                COLOR_T_FCT,
                                                                COLOR_C_FCT);
                            trame.push(Number(uart_items[current_i_fct].content));

                            var k;
                            var pkt_str;
                            for(k=current_i_fct+1; k<i; k++)//navigate throught the reste of data
                            {
                                ScanaStudio.dec_item_new( channel,
                                                        uart_items[k].start_sample_index,
                                                        uart_items[k].end_sample_index);
                                switch(k - current_i_fct)
                                {
                                    case 1:
                                    {
                                        if(current_fct==FCT_WRITE_MULTIPLE_COILS)
                                        {
                                            ScanaStudio.dec_item_add_content("Coil Address Hi : " + uart_items[k].content);
                                            pkt_str = "Coil @ Hi";
                                        }
                                        else
                                        {
                                            ScanaStudio.dec_item_add_content("Starting Address Hi : " + uart_items[k].content);
                                            pkt_str = "Start @ Hi";
                                        }
                                        ScanaStudio.dec_item_add_content("Hi : " + uart_items[k].content);
                                        break;
                                    }
                                    case 2:
                                    {
                                        if(current_fct==FCT_WRITE_MULTIPLE_COILS)
                                        {
                                            ScanaStudio.dec_item_add_content("Coil Address Lo : " + uart_items[k].content);
                                            pkt_str = "Coil @ Lo";
                                        }
                                        else
                                        {
                                            ScanaStudio.dec_item_add_content("Starting Address Lo : " + uart_items[k].content);
                                            pkt_str = "Start @ Lo";
                                        }
                                        ScanaStudio.dec_item_add_content("Lo : " + uart_items[k].content);
                                        break;
                                    }
                                    case 3:
                                    {
                                        if(current_fct==FCT_WRITE_MULTIPLE_COILS)
                                        {
                                            ScanaStudio.dec_item_add_content("Quantity of Coils Hi : " + uart_items[k].content);
                                            pkt_str = "Qty Coil Hi";
                                        }
                                        else
                                        {
                                            ScanaStudio.dec_item_add_content("Quantity of Registers Hi : " + uart_items[k].content);
                                            pkt_str = "Qty Reg Hi";
                                        }
                                        ScanaStudio.dec_item_add_content("Hi : " + uart_items[k].content);
                                        break;
                                    }
                                    case 4:
                                    {
                                        if(current_fct==FCT_WRITE_MULTIPLE_COILS)
                                        {
                                            ScanaStudio.dec_item_add_content("Quantity of Coils Lo : " + uart_items[k].content);
                                            pkt_str = "Qty Coil Lo";
                                        }
                                        else
                                        {
                                            ScanaStudio.dec_item_add_content("Quantity of Registers Lo : " + uart_items[k].content);
                                            pkt_str = "Qty Reg Lo";
                                        }
                                        ScanaStudio.dec_item_add_content("Lo : " + uart_items[k].content);
                                        break;
                                    }
                                    case 5:
                                    {
                                        ScanaStudio.dec_item_add_content( "Byte Count : " + uart_items[k].content );
                                        ScanaStudio.dec_item_add_content( "Cnt : " + uart_items[k].content );
                                        pkt_str = "Cnt";
                                        break;
                                    }
                                    default:
                                    {
                                        if( (k+current_i_fct+1)%2 )
                                        {
                                            ScanaStudio.dec_item_add_content( "Write Data Hi: " + uart_items[k].content );
                                            ScanaStudio.dec_item_add_content("Hi : " + uart_items[k].content);
                                            pkt_str = "W Data Hi";
                                        }
                                        else
                                        {
                                            ScanaStudio.dec_item_add_content( "Write Data Lo: " + uart_items[k].content );
                                            ScanaStudio.dec_item_add_content("Lo : " + uart_items[k].content);
                                            pkt_str = "W Data Lo";
                                        }
                                        break;
                                    }
                                }//end switch k
                                ScanaStudio.dec_item_add_content(uart_items[k].content);
                                ScanaStudio.packet_view_add_packet( false,
                                                                    channel,
                                                                    uart_items[k].start_sample_index,
                                                                    uart_items[k].end_sample_index,
                                                                    pkt_str,
                                                                    uart_items[k].content,
                                                                    COLOR_T_DATA,
                                                                    COLOR_C_DATA);
                                trame.push(Number(uart_items[k].content));
                            }//end for k

                            i--;
                            state_machine = ENUM_STATE_CRC;
                        }
                        break;
                    }//end case FCT_WRITE_MULTIPLE_COILS or FCT_WRITE_MULTIPLE_REGISTERS



                    default:
                    {
                        if(current_fct&0x80) // rapport d'erreur
                        {
                            ScanaStudio.dec_item_new( channel,
                                                    uart_items[current_i_fct].start_sample_index,
                                                    uart_items[current_i_fct].end_sample_index);
                            ScanaStudio.dec_item_add_content( "Function : " + function_to_str(current_fct&0x7F,-1) );
                            ScanaStudio.dec_item_add_content( "Fct : " + function_to_str(current_fct&0x7F,-1) );
                            ScanaStudio.dec_item_add_content( "Fct : " + uart_items[current_i_fct].content );
                            ScanaStudio.dec_item_add_content( uart_items[current_i_fct].content );
                            ScanaStudio.packet_view_add_packet( false,
                                                                channel,
                                                                uart_items[current_i_fct].start_sample_index,
                                                                uart_items[current_i_fct].end_sample_index,
                                                                "Function",
                                                                function_to_str(current_fct&0x7F,-1),
                                                                COLOR_T_ERROR,
                                                                COLOR_C_ERROR);
                            trame.push(Number(uart_items[current_i_fct].content));
                            switch(i-current_i_fct)
                            {
                                case 1:
                                {
                                    var exepction_code = Number(uart_items[i].content);
                                    ScanaStudio.dec_item_new( channel,
                                                            uart_items[i].start_sample_index,
                                                            uart_items[i].end_sample_index);
                                    ScanaStudio.dec_item_add_content( "Exception : " + exception_to_str(exepction_code&0x7F) );
                                    ScanaStudio.dec_item_add_content( "Ex : " + exception_to_str(exepction_code&0x7F) );
                                    ScanaStudio.dec_item_add_content( "Ex : " + uart_items[i].content );
                                    ScanaStudio.dec_item_add_content( uart_items[i].content );
                                    ScanaStudio.dec_item_emphasize_warning();
                                    ScanaStudio.packet_view_add_packet( false,
                                                                        channel,
                                                                        uart_items[i].start_sample_index,
                                                                        uart_items[i].end_sample_index,
                                                                        "Exeption",
                                                                        exception_to_str(exepction_code&0x7F),
                                                                        COLOR_T_ERROR,
                                                                        COLOR_C_ERROR);
                                    trame.push(Number(uart_items[i].content));
                                    break;
                                }
                                default:
                                break;
                            }
                            state_machine = ENUM_STATE_CRC;
                            break;
                        }
                        else
                        {
                            if( (i-current_i_fct == 1)&&(current_i_eof==-1) )//request or answer
                            {
                                ScanaStudio.dec_item_new( channel,
                                                        uart_items[current_i_fct].start_sample_index,
                                                        uart_items[current_i_fct].end_sample_index);
                                ScanaStudio.dec_item_add_content( "Function : " + uart_items[current_i_fct].content );
                                ScanaStudio.dec_item_add_content( "Fct : " + uart_items[current_i_fct].content );
                                ScanaStudio.dec_item_add_content( uart_items[current_i_fct].content );
                                ScanaStudio.packet_view_add_packet( false,
                                                                    channel,
                                                                    uart_items[current_i_fct].start_sample_index,
                                                                    uart_items[current_i_fct].end_sample_index,
                                                                    "Function",
                                                                    uart_items[current_i_fct].content,
                                                                    COLOR_T_FCT,
                                                                    COLOR_C_FCT);
                                trame.push(Number(uart_items[current_i_fct].content));
                                current_byte_cnt = current_i_fct;
                                break;
                            }

                            if( (current_i_eof!=-1) && (i<current_i_eof-2) )
                            {
                                ScanaStudio.dec_item_new( channel,
                                                        uart_items[i].start_sample_index,
                                                        uart_items[i].end_sample_index);
                                ScanaStudio.dec_item_add_content( "Data : " + uart_items[i].content );
                                ScanaStudio.dec_item_add_content( uart_items[i].content );
                                ScanaStudio.packet_view_add_packet( false,
                                                                    channel,
                                                                    uart_items[i].start_sample_index,
                                                                    uart_items[i].end_sample_index,
                                                                    "Data",
                                                                    uart_items[i].content,
                                                                    COLOR_T_DATA,
                                                                    COLOR_C_DATA);
                                trame.push(Number(uart_items[i].content));
                                if(i==current_i_eof-3)
                                {
                                    state_machine = ENUM_STATE_CRC;
                                }
                                break;
                            }
                        }
                        break;
                    }//end default

                }//end switch current_fct

                break;
            }// end ENUM_STATE_FUNCTION

            case ENUM_STATE_CRC:
            {
                if(current_i_crc == -1)
                {
                    current_i_crc = i;
                    break;
                }

                var crc_red = ((Number(uart_items[i].content)<<8)&0xFF00) | (Number(uart_items[i-1].content)&0x00FF);
                var crc_calculated = crc_calculation(trame);

                var crc_str = "0x";
                if (crc_red < 0x10)
                {
                    crc_str += "0";
                }
                crc_str += crc_red.toString(16);

                ScanaStudio.dec_item_new( channel,
                                        uart_items[i-1].start_sample_index,
                                        uart_items[i].end_sample_index);
                if(crc_red == crc_calculated)
                {
                    ScanaStudio.dec_item_add_content( "CRC OK : " + crc_str );
                    ScanaStudio.dec_item_add_content( "CRC " + crc_str );
                    ScanaStudio.dec_item_add_content( crc_str );

                    ScanaStudio.packet_view_add_packet( false,
                                                        channel,
                                                        uart_items[i-1].start_sample_index,
                                                        uart_items[i].end_sample_index,
                                                        "CRC",
                                                        crc_str + " OK",
                                                        COLOR_T_CRC,
                                                        COLOR_C_CRC);
                }
                else //wrong CRC
                {
                    var crc_c_str = "0x";
                    if (crc_calculated < 0x10)
                    {
                        crc_c_str += "0";
                    }
                    crc_c_str += crc_calculated.toString(16);
                    ScanaStudio.dec_item_add_content( "CRC WRONG : " + crc_str + " should be " + crc_c_str );
                    ScanaStudio.dec_item_add_content( "CRC WRONG :" + crc_str );
                    ScanaStudio.dec_item_add_content( crc_str );
                    ScanaStudio.dec_item_emphasize_error();

                    ScanaStudio.packet_view_add_packet( false,
                                                        channel,
                                                        uart_items[i-1].start_sample_index,
                                                        uart_items[i].end_sample_index,
                                                        "CRC",
                                                        crc_str + " Wrong, should be " + crc_c_str,
                                                        COLOR_T_ERROR,
                                                        COLOR_C_ERROR);
                }

                state_machine = ENUM_STATE_SOF;
                break;
            }

            default:
            {
                ScanaStudio.dec_item_new( channel, uart_items[i].start_sample_index, uart_items[i].end_sample_index );
                ScanaStudio.dec_item_add_content( uart_items[i].content );
                ScanaStudio.dec_item_emphasize_warning();
                break;
            }

        }//end switch state machine


    }//end for each uart item
}//end function decode for RTU mode


function on_decode_signals_ASCII_mode(uart_items)
{
    // Remove any element that do not contain data, e.g.: Start, Stop, parity
    var j=0;
    for (j = uart_items.length - 1; j >= 0; j--)
    {
        if( (uart_items[j].content == "Start") ||
            (uart_items[j].content == "Parity OK") ||
            (uart_items[j].content == "Parity ERROR") ||
            (uart_items[j].content == "Stop") ||
            (uart_items[j].content == "Stop bit Missing!") )
        {
            uart_items.splice(j,1);
        }
    }

    for(i=0; (i<uart_items.length)&&(!ScanaStudio.abort_is_requested()); i++)
    {

        if(uart_items[i].content == ":".charCodeAt())//initialisation and detection of frame
        {
            var sof = i;
            var k;
            var eof = -1;
            trame = [];
            for(k = sof; k<uart_items.length; k++)
            {
                trame.push(uart_items[k].content);
                if(k+1 < uart_items.length )
                {
                    if( (uart_items[k].content == "\r".charCodeAt()) && (uart_items[k+1].content == "\n".charCodeAt()) )
                    {
                        eof = k;
                        break;//exit for
                    }
                }
                else if(k - sof > 513)
                {
                    break;//exit for
                }
            }


            if(eof == -1) //no end of frame
            {
                break;
            }

            ScanaStudio.packet_view_add_packet( true,
                                                channel,
                                                uart_items[sof].start_sample_index,
                                                uart_items[sof].end_sample_index,
                                                "Modbus ASCII",
                                                "CH" + (channel + 1),
                                                "#0000FF",
                                                "#8080FF");
            ScanaStudio.packet_view_add_packet( false,
                                                channel,
                                                uart_items[sof].start_sample_index,
                                                uart_items[sof].end_sample_index,
                                                "SOF",
                                                String.fromCharCode(uart_items[sof].content),
                                                "#0000FF",
                                                "#8080FF");

            ScanaStudio.dec_item_new(   channel,
                                        uart_items[sof].start_sample_index,
                                        uart_items[sof].end_sample_index);
            ScanaStudio.dec_item_add_content( "Start Of Frame " + String.fromCharCode(uart_items[sof].content) );
            ScanaStudio.dec_item_add_content( "SOF " + String.fromCharCode(uart_items[sof].content) );
            ScanaStudio.dec_item_add_content( String.fromCharCode(uart_items[sof].content) );

            current_i_fct = -1;
            current_byte_cnt = -1;
            var byte_value = 0;
            var lrc = 0;

            state_machine = ENUM_STATE_SLAVE_ADDR;

            for(k = sof+1; k<eof; k++)
            {
                var tmp_val; //char value detection
                if( (uart_items[k].content >= 0x30) && (uart_items[k].content <= 0x39) ) //0-9
                {
                    tmp_val = uart_items[k].content - 0x30;
                }
                else if( (uart_items[k].content >= 0x41) && (uart_items[k].content <= 0x46) ) //A-F
                {
                    tmp_val = uart_items[k].content - 0x41 + 10;
                }
                else if( (uart_items[k].content >= 0x61) && (uart_items[k].content <= 0x66) ) //A-F
                {
                    tmp_val = uart_items[k].content - 0x61 + 10;
                }
                else
                {
                    ScanaStudio.dec_item_new(   channel,
                                                uart_items[k].start_sample_index,
                                                uart_items[k].end_sample_index);
                    ScanaStudio.dec_item_add_content( "Unknown char code :'" + String.fromCharCode(uart_items[k].content) + "' " + uart_items[k].content );
                    ScanaStudio.dec_item_add_content( "'" + String.fromCharCode(uart_items[k].content) + "' " + uart_items[k].content );
                    ScanaStudio.dec_item_add_content( uart_items[k].content );
                    ScanaStudio.dec_item_emphasize_warning();
                }

                if( (k+sof)%2 == 1 ) //first byte
                {
                    byte_value = tmp_val * 16;
                    continue;
                }
                else( (k+sof)%2 == 0 )
                {
                    byte_value += tmp_val;
                }


                switch(state_machine)
                {
                    case ENUM_STATE_SLAVE_ADDR:
                    {
                        ScanaStudio.dec_item_new(   channel,
                                                    uart_items[k-1].start_sample_index,
                                                    uart_items[k].end_sample_index);
                        ScanaStudio.dec_item_add_content( "Slave Address : " + dec_to_str(byte_value, "0x") );
                        ScanaStudio.dec_item_add_content( "Slave Addr: " + dec_to_str(byte_value, "0x") );
                        ScanaStudio.dec_item_add_content( "Addr:" + dec_to_str(byte_value, "0x") );
                        ScanaStudio.dec_item_add_content( dec_to_str(byte_value, "0x") );
                        ScanaStudio.packet_view_add_packet( false,
                                                            channel,
                                                            uart_items[k-1].start_sample_index,
                                                            uart_items[k].end_sample_index,
                                                            "Slave Addr:",
                                                            "@" + dec_to_str(byte_value, "0x"),
                                                            COLOR_T_ADDR,
                                                            COLOR_C_ADDR);

                        lrc += byte_value;
                        state_machine = ENUM_STATE_FUNCTION;
                        break;
                    }


                    case ENUM_STATE_FUNCTION:
                    {
                        current_fct = byte_value;
                        current_i_fct = k;
                        lrc += byte_value;
                        current_byte_cnt = -1
                        state_machine = ENUM_STATE_AFTER_FUNCTION;
                        break;
                    }


                    case ENUM_STATE_AFTER_FUNCTION:
                    {
                        switch(current_fct)
                        {
                            case FCT_READ_COIL_STATUS:
                            case FCT_READ_INPUT_STATUS:
                            case FCT_READ_HOLDING_REGISTERS:
                            case FCT_READ_INPUT_REGISTERS:
                            {
                                //current_byte_cnt calculation
                                if(current_byte_cnt == -1)
                                {
                                    current_byte_cnt = byte_value;
                                }


                                if( ( current_byte_cnt*2 !=(eof - sof - 9) )&&( eof - sof == 15 ) )//request
                                {
                                    if( Math.round((k-(sof+4))/2) == 1)
                                    {
                                        ScanaStudio.dec_item_new(   channel,
                                                                    uart_items[current_i_fct-1].start_sample_index,
                                                                    uart_items[current_i_fct].end_sample_index);
                                        ScanaStudio.dec_item_add_content( "Function : " + function_to_str(current_fct,1) );
                                        ScanaStudio.dec_item_add_content( "Fct : " + function_to_str(current_fct,1) );
                                        ScanaStudio.dec_item_add_content( "Fct : " + dec_to_str(current_fct, "0x") );
                                        ScanaStudio.dec_item_add_content( dec_to_str(current_fct, "0x") );
                                        ScanaStudio.packet_view_add_packet( false,
                                                                            channel,
                                                                            uart_items[current_i_fct-1].start_sample_index,
                                                                            uart_items[current_i_fct].end_sample_index,
                                                                            "Function",
                                                                            function_to_str(current_fct,1),
                                                                            COLOR_T_FCT,
                                                                            COLOR_C_FCT);
                                    }

                                    var pkt_str;
                                    ScanaStudio.dec_item_new(   channel,
                                                                uart_items[k-1].start_sample_index,
                                                                uart_items[k].end_sample_index);
                                    switch( Math.round((k-(sof+4))/2) )
                                    {
                                        case 1:
                                        {
                                            ScanaStudio.dec_item_add_content("Starting Address Hi : " + dec_to_str(byte_value, "0x") );
                                            ScanaStudio.dec_item_add_content("Hi : " + dec_to_str(byte_value, "0x") );
                                            pkt_str = "Starting @ Hi";
                                            break;
                                        }
                                        case 2:
                                        {
                                            ScanaStudio.dec_item_add_content("Starting Address Lo : " + dec_to_str(byte_value, "0x") );
                                            ScanaStudio.dec_item_add_content("Lo : " + dec_to_str(byte_value, "0x") );
                                            pkt_str = "Starting @ Lo";
                                            break;
                                        }
                                        case 3:
                                        {
                                            if(current_fct==FCT_READ_COIL_STATUS)
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Coils Hi : " + dec_to_str(byte_value, "0x") );
                                                pkt_str = "Qty Coils @ Hi";
                                            }
                                            else if(current_fct==FCT_READ_INPUT_STATUS)
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of inputs Hi : " + dec_to_str(byte_value, "0x") );
                                                pkt_str = "Qty Input @ Hi";
                                            }
                                            else if( (current_fct==FCT_READ_HOLDING_REGISTERS) || (current_fct==FCT_READ_INPUT_REGISTERS) )
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Register Hi : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Qty Reg @ Hi";
                                            }
                                            ScanaStudio.dec_item_add_content("Hi : " + dec_to_str(byte_value, "0x"));
                                            break;
                                        }
                                        case 4:
                                        {
                                            if(current_fct==FCT_READ_COIL_STATUS)
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Coils Lo : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Qty Coils @ Lo";
                                            }
                                            else if(current_fct==FCT_READ_INPUT_STATUS)
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of inputs Lo : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Qty Input @ Lo";
                                            }
                                            else if( (current_fct==FCT_READ_HOLDING_REGISTERS) || (current_fct==FCT_READ_INPUT_REGISTERS) )
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Register Lo : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Qty Reg @ Lo";
                                            }
                                            ScanaStudio.dec_item_add_content("Lo : " +dec_to_str(byte_value, "0x"));
                                            break;
                                        }
                                        default:
                                        {
                                            ScanaStudio.dec_item_add_content("Unknown item : " +dec_to_str(byte_value, "0x"));
                                            ScanaStudio.dec_item_emphasize_warning();
                                            pkt_str = "...";
                                            break;
                                        }
                                    }//end switch k
                                    lrc += byte_value;
                                    ScanaStudio.dec_item_add_content( dec_to_str(byte_value, "0x") );
                                    ScanaStudio.packet_view_add_packet( false,
                                                                        channel,
                                                                        uart_items[k-1].start_sample_index,
                                                                        uart_items[k].end_sample_index,
                                                                        pkt_str,
                                                                        dec_to_str(byte_value, "0x"),
                                                                        COLOR_T_DATA,
                                                                        COLOR_C_DATA);

                                }//end request
                                else if( current_byte_cnt*2 ==(eof - sof - 9) )//answer
                                {
                                    if( Math.round((k-(sof+4))/2) == 1)
                                    {
                                        ScanaStudio.dec_item_new(   channel,
                                                                    uart_items[current_i_fct-1].start_sample_index,
                                                                    uart_items[current_i_fct].end_sample_index);
                                        ScanaStudio.dec_item_add_content( "Function : " + function_to_str(current_fct,0) );
                                        ScanaStudio.dec_item_add_content( "Fct : " + function_to_str(current_fct,0) );
                                        ScanaStudio.dec_item_add_content( "Fct : " + dec_to_str(current_fct, "0x") );
                                        ScanaStudio.dec_item_add_content( dec_to_str(current_fct, "0x") );
                                        ScanaStudio.packet_view_add_packet( false,
                                                                            channel,
                                                                            uart_items[current_i_fct-1].start_sample_index,
                                                                            uart_items[current_i_fct].end_sample_index,
                                                                            "Function",
                                                                            function_to_str(current_fct,1),
                                                                            COLOR_T_FCT,
                                                                            COLOR_C_FCT);
                                    }

                                    var pkt_str;
                                    ScanaStudio.dec_item_new(   channel,
                                                                uart_items[k-1].start_sample_index,
                                                                uart_items[k].end_sample_index);


                                    if( Math.round((k-(sof+4))/2) == 1)
                                    {
                                        ScanaStudio.dec_item_add_content( "Byte Count : " + dec_to_str(byte_value, "0x") );
                                        ScanaStudio.dec_item_add_content( "Cnt : " + dec_to_str(byte_value, "0x") );
                                        pkt_str = "Cnt"
                                    }
                                    else
                                    {
                                        if( (current_fct==FCT_READ_COIL_STATUS) || (current_fct==FCT_READ_INPUT_STATUS) )
                                        {
                                            ScanaStudio.dec_item_add_content( "Data : " + dec_to_str(byte_value, "0x") );
                                            pkt_str = "Data";
                                        }
                                        else if( (current_fct==FCT_READ_HOLDING_REGISTERS) || (current_fct==FCT_READ_INPUT_REGISTERS) )
                                        {
                                            if( Math.round((k-(sof+4))/2)%2 )
                                            {
                                                ScanaStudio.dec_item_add_content( "Data Lo: " + dec_to_str(byte_value, "0x") );
                                                ScanaStudio.dec_item_add_content("Lo : " + dec_to_str(byte_value, "0x") );
                                                pkt_str = "Data Lo";
                                            }
                                            else
                                            {
                                                ScanaStudio.dec_item_add_content( "Data Hi: " + dec_to_str(byte_value, "0x") );
                                                ScanaStudio.dec_item_add_content("Hi : " + dec_to_str(byte_value, "0x") );
                                                pkt_str = "Data Hi";
                                            }
                                        }
                                    }
                                    ScanaStudio.dec_item_add_content( dec_to_str(byte_value, "0x") );
                                    ScanaStudio.packet_view_add_packet( false,
                                                                        channel,
                                                                        uart_items[k-1].start_sample_index,
                                                                        uart_items[k].end_sample_index,
                                                                        pkt_str,
                                                                        dec_to_str(byte_value, "0x"),
                                                                        COLOR_T_DATA,
                                                                        COLOR_C_DATA);
                                    lrc += byte_value;

                                }//end answer
                                else //error
                                {

                                    if( Math.round((k-(sof+4))/2) == 1)
                                    {
                                        ScanaStudio.dec_item_new(   channel,
                                                                    uart_items[current_i_fct-1].start_sample_index,
                                                                    uart_items[current_i_fct].end_sample_index);
                                        ScanaStudio.dec_item_add_content( "Function wrong length: " + function_to_str(current_fct,0) );
                                        ScanaStudio.dec_item_add_content( "Fct !len: " + function_to_str(current_fct,0) );
                                        ScanaStudio.dec_item_add_content( "Fct !len: " + dec_to_str(current_fct, "0x") );
                                        ScanaStudio.dec_item_add_content( dec_to_str(current_fct, "0x") );
                                        ScanaStudio.dec_item_emphasize_warning();
                                        ScanaStudio.packet_view_add_packet( false,
                                                                            channel,
                                                                            uart_items[current_i_fct-1].start_sample_index,
                                                                            uart_items[current_i_fct].end_sample_index,
                                                                            "Function",
                                                                            "wrong length ! fct type :" + dec_to_str(current_fct, "0x"),
                                                                            COLOR_T_FCT,
                                                                            COLOR_C_FCT);
                                    }

                                    ScanaStudio.dec_item_new(   channel,
                                                                uart_items[k-1].start_sample_index,
                                                                uart_items[k].end_sample_index);
                                    ScanaStudio.dec_item_add_content("Unknown item : " + dec_to_str(byte_value, "0x"));
                                    ScanaStudio.dec_item_add_content( dec_to_str(byte_value, "0x") );
                                    ScanaStudio.dec_item_emphasize_warning();
                                    ScanaStudio.packet_view_add_packet( false,
                                                                        channel,
                                                                        uart_items[k-1].start_sample_index,
                                                                        uart_items[k].end_sample_index,
                                                                        "Unknown",
                                                                        dec_to_str(byte_value, "0x"),
                                                                        COLOR_T_DATA,
                                                                        COLOR_C_DATA);
                                    lrc += byte_value;
                                }

                                if(eof-3 == k)
                                {
                                    state_machine = ENUM_STATE_LRC;
                                }
                                else if(eof-3 < k)
                                {
                                    ScanaStudio.dec_item_new(   channel,
                                                                uart_items[k-1].start_sample_index,
                                                                uart_items[k].end_sample_index);
                                    ScanaStudio.dec_item_add_content("UNEXPECTED ERROR");
                                    ScanaStudio.dec_item_add_content("ERROR");
                                    ScanaStudio.dec_item_emphasize_error();
                                }
                                break;
                            }//end case FCT_READ_COIL_STATUS or FCT_READ_INPUT_STATUS or FCT_READ_HOLDING_REGISTERS or FCT_READ_INPUT_REGISTERS



                            case FCT_WRITE_SINGLE_COIL:
                            case FCT_WRITE_SINGLE_REGISTER:
                            {
                                if( Math.round((k-(sof+4))/2) == 1)
                                {
                                    ScanaStudio.dec_item_new(   channel,
                                                                uart_items[current_i_fct-1].start_sample_index,
                                                                uart_items[current_i_fct].end_sample_index);
                                    ScanaStudio.dec_item_add_content( "Function : " + function_to_str(current_fct,1) );
                                    ScanaStudio.dec_item_add_content( "Fct : " + function_to_str(current_fct,1) );
                                    ScanaStudio.dec_item_add_content( "Fct : " + dec_to_str(current_fct, "0x") );
                                    ScanaStudio.dec_item_add_content( dec_to_str(current_fct, "0x") );
                                    ScanaStudio.packet_view_add_packet( false,
                                                                        channel,
                                                                        uart_items[current_i_fct-1].start_sample_index,
                                                                        uart_items[current_i_fct].end_sample_index,
                                                                        "Function",
                                                                        function_to_str(current_fct,1),
                                                                        COLOR_T_FCT,
                                                                        COLOR_C_FCT);
                                }
                                var pkt_str;
                                ScanaStudio.dec_item_new(   channel,
                                                            uart_items[k-1].start_sample_index,
                                                            uart_items[k].end_sample_index);
                                switch( Math.round((k-(sof+4))/2) )
                                {
                                    case 1:
                                    {
                                        if(current_fct==FCT_WRITE_SINGLE_COIL)
                                        {
                                            ScanaStudio.dec_item_add_content("Coil Address Hi : " + dec_to_str(byte_value, "0x") );
                                            pkt_str = "Coil @ Hi";
                                        }
                                        else
                                        {
                                            ScanaStudio.dec_item_add_content("Register Address Hi : " + dec_to_str(byte_value, "0x") );
                                            pkt_str = "Reg @ Hi";
                                        }
                                        ScanaStudio.dec_item_add_content("Hi : " +dec_to_str(byte_value, "0x") );
                                        break;
                                    }
                                    case 2:
                                    {
                                        if(current_fct==FCT_WRITE_SINGLE_COIL)
                                        {
                                            ScanaStudio.dec_item_add_content("Coil Address Lo : " + dec_to_str(byte_value, "0x"));
                                            pkt_str = "Coil @ Lo";
                                        }
                                        else
                                        {
                                            ScanaStudio.dec_item_add_content("Register Address Lo : " + dec_to_str(byte_value, "0x"));
                                            pkt_str = "Reg @ Lo";
                                        }
                                        ScanaStudio.dec_item_add_content("Lo : " + dec_to_str(byte_value, "0x"));
                                        break;
                                    }
                                    case 3:
                                    {
                                        ScanaStudio.dec_item_add_content("Write Data Hi : " + dec_to_str(byte_value, "0x"));
                                        ScanaStudio.dec_item_add_content("Hi : " + dec_to_str(byte_value, "0x"));
                                        pkt_str = "W Data Hi";
                                        break;
                                    }
                                    case 4:
                                    {
                                        ScanaStudio.dec_item_add_content("Write Data Lo : " + dec_to_str(byte_value, "0x"));
                                        ScanaStudio.dec_item_add_content("Lo : " + dec_to_str(byte_value, "0x"));
                                        pkt_str = "W Data Lo";
                                        break;
                                    }
                                    default:
                                    {
                                        ScanaStudio.dec_item_add_content("Unknown item : " + dec_to_str(byte_value, "0x") );
                                        ScanaStudio.dec_item_emphasize_warning();
                                        pkt_str = "...";
                                        break;
                                    }
                                }//end switch iterator in frame
                                lrc += byte_value;
                                ScanaStudio.dec_item_add_content( dec_to_str(byte_value, "0x") );
                                ScanaStudio.packet_view_add_packet( false,
                                                                    channel,
                                                                    uart_items[k-1].start_sample_index,
                                                                    uart_items[k].end_sample_index,
                                                                    pkt_str,
                                                                    dec_to_str(byte_value, "0x"),
                                                                    COLOR_T_DATA,
                                                                    COLOR_C_DATA);


                                if(eof-3 == k)
                                {
                                    state_machine = ENUM_STATE_LRC;
                                }
                                else if(eof-3 < k)
                                {
                                    ScanaStudio.dec_item_new(   channel,
                                                                uart_items[k-1].start_sample_index,
                                                                uart_items[k].end_sample_index);
                                    ScanaStudio.dec_item_add_content("UNEXPECTED ERROR");
                                    ScanaStudio.dec_item_add_content("ERROR");
                                    ScanaStudio.dec_item_emphasize_error();
                                }
                                break;
                            }//end case FCT_WRITE_SINGLE_COIL and FCT_WRITE_SINGLE_REGISTER



                            case FCT_WRITE_MULTIPLE_COILS:
                            case FCT_WRITE_MULTIPLE_REGISTERS:
                            {
                                //current_byte_cnt calculation
                                if((eof - sof >= 15)&&(current_byte_cnt == -1))
                                {
                                    var tmp_char; //char value detection
                                    var tmp_val; //char value detection
                                    var tmp_i=0;
                                    for(tmp_i = 0; tmp_i<2; tmp_i++)
                                    {
                                        if( (uart_items[sof+13+tmp_i].content >= 0x30) && (uart_items[sof+13+tmp_i].content <= 0x39) ) //0-9
                                        {
                                            tmp_char = uart_items[sof+13+tmp_i].content - 0x30;
                                        }
                                        else if( (uart_items[sof+13+tmp_i].content >= 0x41) && (uart_items[sof+13+tmp_i].content <= 0x46) ) //A-F
                                        {
                                            tmp_char = uart_items[sof+13+tmp_i].content - 0x41 + 10;
                                        }
                                        else if( (uart_items[sof+13+tmp_i].content >= 0x61) && (uart_items[sof+13+tmp_i].content <= 0x66) ) //A-F
                                        {
                                            tmp_char = uart_items[sof+13+tmp_i].content - 0x61 + 10;
                                        }
                                        else
                                        {
                                            ScanaStudio.dec_item_new(   channel,
                                                                        uart_items[k].start_sample_index,
                                                                        uart_items[k].end_sample_index);
                                            ScanaStudio.dec_item_add_content( "Unknown char code :'" + String.fromCharCode(uart_items[k].content) + "' " + uart_items[k].content );
                                            ScanaStudio.dec_item_add_content( "'" + String.fromCharCode(uart_items[k].content) + "' " + uart_items[k].content );
                                            ScanaStudio.dec_item_add_content( uart_items[k].content );
                                            ScanaStudio.dec_item_emphasize_warning();
                                        }

                                        if( tmp_i == 0 ) //first byte
                                        {
                                            tmp_val = tmp_char * 16;
                                        }
                                        else
                                        {
                                            tmp_val += tmp_char;
                                        }
                                    }


                                    current_byte_cnt = tmp_val;
                                }


                                if( eof - sof == 15 )//answer
                                {
                                    if( Math.round((k-(sof+4))/2) == 1)
                                    {
                                        ScanaStudio.dec_item_new(   channel,
                                                                    uart_items[current_i_fct-1].start_sample_index,
                                                                    uart_items[current_i_fct].end_sample_index);
                                        ScanaStudio.dec_item_add_content( "Function : " + function_to_str(current_fct,0) );
                                        ScanaStudio.dec_item_add_content( "Fct : " + function_to_str(current_fct,0) );
                                        ScanaStudio.dec_item_add_content( "Fct : " + dec_to_str(current_fct, "0x") );
                                        ScanaStudio.dec_item_add_content( dec_to_str(current_fct, "0x") );
                                        ScanaStudio.packet_view_add_packet( false,
                                                                            channel,
                                                                            uart_items[current_i_fct-1].start_sample_index,
                                                                            uart_items[current_i_fct].end_sample_index,
                                                                            "Function",
                                                                            function_to_str(current_fct,1),
                                                                            COLOR_T_FCT,
                                                                            COLOR_C_FCT);
                                    }

                                    var pkt_str;
                                    ScanaStudio.dec_item_new(   channel,
                                                                uart_items[k-1].start_sample_index,
                                                                uart_items[k].end_sample_index);

                                    switch( Math.round((k-(sof+4))/2) )
                                    {
                                        case 1:
                                        {
                                            if(current_fct==FCT_WRITE_MULTIPLE_COILS)
                                            {
                                                ScanaStudio.dec_item_add_content("Coil Address Hi : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Coil @ Hi";
                                            }
                                            else
                                            {
                                                ScanaStudio.dec_item_add_content("Starting Address Hi : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Start @ Hi";
                                            }
                                            ScanaStudio.dec_item_add_content("Hi : " + dec_to_str(byte_value, "0x"));
                                            break;
                                        }
                                        case 2:
                                        {
                                            if(current_fct==FCT_WRITE_MULTIPLE_COILS)
                                            {
                                                ScanaStudio.dec_item_add_content("Coil Address Lo : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Coil @ Lo";
                                            }
                                            else
                                            {
                                                ScanaStudio.dec_item_add_content("Starting Address Lo : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Start @ Lo";
                                            }
                                            ScanaStudio.dec_item_add_content("Lo : " + dec_to_str(byte_value, "0x"));
                                            break;
                                        }
                                        case 3:
                                        {
                                            if(current_fct==FCT_WRITE_MULTIPLE_COILS)
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Coils Hi : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Qty Coil Hi";
                                            }
                                            else
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Registers Hi : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Qty Reg Hi";
                                            }
                                            ScanaStudio.dec_item_add_content("Hi : " + dec_to_str(byte_value, "0x"));
                                            break;
                                        }
                                        case 4:
                                        {
                                            if(current_fct==FCT_WRITE_MULTIPLE_COILS)
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Coils Lo : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Qty Coil Lo";
                                            }
                                            else
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Registers Lo : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Qty Reg Lo";
                                            }
                                            ScanaStudio.dec_item_add_content("Lo : " + dec_to_str(byte_value, "0x"));
                                            break;
                                        }
                                        default:
                                        {
                                            ScanaStudio.dec_item_add_content("Unknown item : " + dec_to_str(byte_value, "0x"));
                                            pkt_str = "...";
                                            break;
                                        }

                                    }//end switch k

                                    ScanaStudio.dec_item_add_content( dec_to_str(byte_value, "0x") );
                                    ScanaStudio.packet_view_add_packet( false,
                                                                        channel,
                                                                        uart_items[k-1].start_sample_index,
                                                                        uart_items[k].end_sample_index,
                                                                        pkt_str,
                                                                        dec_to_str(byte_value, "0x"),
                                                                        COLOR_T_DATA,
                                                                        COLOR_C_DATA);
                                    lrc += byte_value;

                                }//end answer
                                else if( current_byte_cnt*2 ==(eof - sof - 17) )//answer
                                {
                                    if( Math.round((k-(sof+4))/2) == 1)
                                    {
                                        ScanaStudio.dec_item_new(   channel,
                                                                    uart_items[current_i_fct-1].start_sample_index,
                                                                    uart_items[current_i_fct].end_sample_index);
                                        ScanaStudio.dec_item_add_content( "Function : " + function_to_str(current_fct,1) );
                                        ScanaStudio.dec_item_add_content( "Fct : " + function_to_str(current_fct,1) );
                                        ScanaStudio.dec_item_add_content( "Fct : " + dec_to_str(current_fct, "0x") );
                                        ScanaStudio.dec_item_add_content( dec_to_str(current_fct, "0x") );
                                        ScanaStudio.packet_view_add_packet( false,
                                                                            channel,
                                                                            uart_items[current_i_fct-1].start_sample_index,
                                                                            uart_items[current_i_fct].end_sample_index,
                                                                            "Function",
                                                                            function_to_str(current_fct,1),
                                                                            COLOR_T_FCT,
                                                                            COLOR_C_FCT);
                                    }

                                    var pkt_str;
                                    ScanaStudio.dec_item_new(   channel,
                                                                uart_items[k-1].start_sample_index,
                                                                uart_items[k].end_sample_index);

                                    switch(Math.round((k-(sof+4))/2))
                                    {
                                        case 1:
                                        {
                                            if(current_fct==FCT_WRITE_MULTIPLE_COILS)
                                            {
                                                ScanaStudio.dec_item_add_content("Coil Address Hi : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Coil @ Hi";
                                            }
                                            else
                                            {
                                                ScanaStudio.dec_item_add_content("Starting Address Hi : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Start @ Hi";
                                            }
                                            ScanaStudio.dec_item_add_content("Hi : " + dec_to_str(byte_value, "0x"));
                                            break;
                                        }
                                        case 2:
                                        {
                                            if(current_fct==FCT_WRITE_MULTIPLE_COILS)
                                            {
                                                ScanaStudio.dec_item_add_content("Coil Address Lo : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Coil @ Lo";
                                            }
                                            else
                                            {
                                                ScanaStudio.dec_item_add_content("Starting Address Lo : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Start @ Lo";
                                            }
                                            ScanaStudio.dec_item_add_content("Lo : " + dec_to_str(byte_value, "0x"));
                                            break;
                                        }
                                        case 3:
                                        {
                                            if(current_fct==FCT_WRITE_MULTIPLE_COILS)
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Coils Hi : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Qty Coil Hi";
                                            }
                                            else
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Registers Hi : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Qty Reg Hi";
                                            }
                                            ScanaStudio.dec_item_add_content("Hi : " + dec_to_str(byte_value, "0x"));
                                            break;
                                        }
                                        case 4:
                                        {
                                            if(current_fct==FCT_WRITE_MULTIPLE_COILS)
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Coils Lo : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Qty Coil Lo";
                                            }
                                            else
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Registers Lo : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Qty Reg Lo";
                                            }
                                            ScanaStudio.dec_item_add_content("Lo : " + dec_to_str(byte_value, "0x"));
                                            break;
                                        }
                                        case 5:
                                        {
                                            ScanaStudio.dec_item_add_content( "Byte Count : " + dec_to_str(byte_value, "0x") );
                                            ScanaStudio.dec_item_add_content( "Cnt : " + dec_to_str(byte_value, "0x") );
                                            pkt_str = "Cnt";
                                            break;
                                        }
                                        default:
                                        {
                                            if( (k+current_i_fct+1)%2 )
                                            {
                                                ScanaStudio.dec_item_add_content( "Write Data Hi: " + dec_to_str(byte_value, "0x") );
                                                ScanaStudio.dec_item_add_content("Hi : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "W Data Hi";
                                            }
                                            else
                                            {
                                                ScanaStudio.dec_item_add_content( "Write Data Lo: " + dec_to_str(byte_value, "0x") );
                                                ScanaStudio.dec_item_add_content("Lo : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "W Data Lo";
                                            }
                                            break;
                                        }
                                    }

                                    lrc += byte_value;
                                    ScanaStudio.dec_item_add_content( dec_to_str(byte_value, "0x") );
                                    ScanaStudio.packet_view_add_packet( false,
                                                                        channel,
                                                                        uart_items[k-1].start_sample_index,
                                                                        uart_items[k].end_sample_index,
                                                                        pkt_str,
                                                                        dec_to_str(byte_value, "0x"),
                                                                        COLOR_T_DATA,
                                                                        COLOR_C_DATA);

                                }//end request
                                else //error
                                {

                                    if( Math.round((k-(sof+4))/2) == 1)
                                    {
                                        ScanaStudio.dec_item_new(   channel,
                                                                    uart_items[current_i_fct-1].start_sample_index,
                                                                    uart_items[current_i_fct].end_sample_index);
                                        ScanaStudio.dec_item_add_content( "Function wrong length: " + function_to_str(current_fct,0) );
                                        ScanaStudio.dec_item_add_content( "Fct !len: " + function_to_str(current_fct,0) );
                                        ScanaStudio.dec_item_add_content( "Fct !len: " + dec_to_str(current_fct, "0x") );
                                        ScanaStudio.dec_item_add_content( dec_to_str(current_fct, "0x") );
                                        ScanaStudio.dec_item_emphasize_warning();
                                        ScanaStudio.packet_view_add_packet( false,
                                                                            channel,
                                                                            uart_items[current_i_fct-1].start_sample_index,
                                                                            uart_items[current_i_fct].end_sample_index,
                                                                            "Function",
                                                                            "wrong length ! fct type :" + dec_to_str(current_fct, "0x"),
                                                                            COLOR_T_FCT,
                                                                            COLOR_C_FCT);
                                    }

                                    ScanaStudio.dec_item_new(   channel,
                                                                uart_items[k-1].start_sample_index,
                                                                uart_items[k].end_sample_index);
                                    ScanaStudio.dec_item_add_content("Unknown item : " + dec_to_str(byte_value, "0x"));
                                    ScanaStudio.dec_item_add_content( dec_to_str(byte_value, "0x") );
                                    ScanaStudio.dec_item_emphasize_warning();
                                    ScanaStudio.packet_view_add_packet( false,
                                                                        channel,
                                                                        uart_items[k-1].start_sample_index,
                                                                        uart_items[k].end_sample_index,
                                                                        "Unknown",
                                                                        dec_to_str(byte_value, "0x"),
                                                                        COLOR_T_DATA,
                                                                        COLOR_C_DATA);
                                    lrc += byte_value;
                                }

                                if(eof-3 == k)
                                {
                                    state_machine = ENUM_STATE_LRC;
                                }
                                else if(eof-3 < k)
                                {
                                    ScanaStudio.dec_item_new(   channel,
                                                                uart_items[k-1].start_sample_index,
                                                                uart_items[k].end_sample_index);
                                    ScanaStudio.dec_item_add_content("UNEXPECTED ERROR");
                                    ScanaStudio.dec_item_add_content("ERROR");
                                    ScanaStudio.dec_item_emphasize_error();
                                }
                                break;
                            }//end case FCT_WRITE_MULTIPLE_COILS and FCT_WRITE_MULTIPLE_REGISTERS



                            default:
                            {
                                if( (current_fct&0x80)&&( eof - sof == 9 ) )
                                {
                                    if( Math.round((k-(sof+4))/2) == 1)
                                    {
                                        ScanaStudio.dec_item_new(   channel,
                                                                    uart_items[current_i_fct-1].start_sample_index,
                                                                    uart_items[current_i_fct].end_sample_index);
                                        ScanaStudio.dec_item_add_content( "Function : " + function_to_str(current_fct&0x7F,-1) );
                                        ScanaStudio.dec_item_add_content( "Fct : " + function_to_str(current_fct&0x7F,-1) );
                                        ScanaStudio.dec_item_add_content( "Fct : " + dec_to_str(current_fct, "0x") );
                                        ScanaStudio.dec_item_add_content( dec_to_str(current_fct, "0x") );
                                        ScanaStudio.packet_view_add_packet( false,
                                                                            channel,
                                                                            uart_items[current_i_fct-1].start_sample_index,
                                                                            uart_items[current_i_fct].end_sample_index,
                                                                            "Function",
                                                                            dec_to_str(current_fct, "0x"),
                                                                            COLOR_T_FCT,
                                                                            COLOR_C_FCT);
                                    }

                                    ScanaStudio.dec_item_new( channel,
                                                            uart_items[k-1].start_sample_index,
                                                            uart_items[k].end_sample_index);
                                    ScanaStudio.dec_item_add_content( "Exception : " + exception_to_str(byte_value&0x7F) );
                                    ScanaStudio.dec_item_add_content( "Ex : " + exception_to_str(byte_value&0x7F) );
                                    ScanaStudio.dec_item_add_content( "Ex : " + dec_to_str(byte_value, "0x") );
                                    ScanaStudio.dec_item_add_content( dec_to_str(byte_value, "0x") );
                                    ScanaStudio.dec_item_emphasize_warning();
                                    ScanaStudio.packet_view_add_packet( false,
                                                                        channel,
                                                                        uart_items[k-1].start_sample_index,
                                                                        uart_items[k].end_sample_index,
                                                                        "Exeption",
                                                                        exception_to_str(byte_value&0x7F),
                                                                        COLOR_T_ERROR,
                                                                        COLOR_C_ERROR);
                                    lrc += byte_value;
                                }
                                else//unknown function
                                {
                                    if( Math.round((k-(sof+4))/2) == 1)
                                    {
                                        ScanaStudio.dec_item_new(   channel,
                                                                    uart_items[current_i_fct-1].start_sample_index,
                                                                    uart_items[current_i_fct].end_sample_index);
                                        ScanaStudio.dec_item_add_content( "Function : " + dec_to_str(current_fct, "0x") );
                                        ScanaStudio.dec_item_add_content( "Fct : " + dec_to_str(current_fct, "0x") );
                                        ScanaStudio.dec_item_add_content( dec_to_str(current_fct, "0x") );
                                        ScanaStudio.packet_view_add_packet( false,
                                                                            channel,
                                                                            uart_items[current_i_fct-1].start_sample_index,
                                                                            uart_items[current_i_fct].end_sample_index,
                                                                            "Function",
                                                                            dec_to_str(current_fct, "0x"),
                                                                            COLOR_T_FCT,
                                                                            COLOR_C_FCT);
                                    }

                                    ScanaStudio.dec_item_new(   channel,
                                                                uart_items[k-1].start_sample_index,
                                                                uart_items[k].end_sample_index);
                                    ScanaStudio.dec_item_add_content("Data : " + dec_to_str(byte_value, "0x"));
                                    ScanaStudio.dec_item_add_content( dec_to_str(byte_value, "0x") );
                                    ScanaStudio.packet_view_add_packet( false,
                                                                        channel,
                                                                        uart_items[k-1].start_sample_index,
                                                                        uart_items[k].end_sample_index,
                                                                        "Data",
                                                                        dec_to_str(byte_value, "0x"),
                                                                        COLOR_T_DATA,
                                                                        COLOR_C_DATA);
                                    lrc += byte_value;
                                }


                                if(eof-3 == k)
                                {
                                state_machine = ENUM_STATE_LRC;
                                }
                                else if(eof-3 < k)
                                {
                                    ScanaStudio.dec_item_new(   channel,
                                                                uart_items[k-1].start_sample_index,
                                                                uart_items[k].end_sample_index);
                                    ScanaStudio.dec_item_add_content("UNEXPECTED ERROR");
                                    ScanaStudio.dec_item_add_content("ERROR");
                                    ScanaStudio.dec_item_emphasize_error();
                                }
                                break;
                            }//end default

                        }
                        break;
                    }//end case ENUM_STATE_AFTER_FUNCTION


                    case ENUM_STATE_LRC:
                    {
    					lrc= (-lrc)%256;
    					lrc = 256+lrc;

                        ScanaStudio.dec_item_new(   channel,
                                                    uart_items[k-1].start_sample_index,
                                                    uart_items[k].end_sample_index);
                        if(lrc == byte_value)
                        {
                            ScanaStudio.dec_item_add_content( "LRC OK : " + dec_to_str(byte_value, "0x") );
                            ScanaStudio.dec_item_add_content( "LRC " + dec_to_str(byte_value, "0x") );
                            ScanaStudio.dec_item_add_content( dec_to_str(byte_value, "0x") );

                            ScanaStudio.packet_view_add_packet( false,
                                                                channel,
                                                                uart_items[k-1].start_sample_index,
                                                                uart_items[k].end_sample_index,
                                                                "LRC",
                                                                dec_to_str(byte_value, "0x") + " OK",
                                                                COLOR_T_CRC,
                                                                COLOR_C_CRC);
                        }
                        else //wrong LRC
                        {
                            ScanaStudio.dec_item_add_content( "LRC WRONG : " + dec_to_str(byte_value, "0x") + " should be " + dec_to_str(lrc, "0x") );
                            ScanaStudio.dec_item_add_content( "LRC WRONG :" + dec_to_str(byte_value, "0x") );
                            ScanaStudio.dec_item_add_content( dec_to_str(byte_value, "0x") );
                            ScanaStudio.dec_item_emphasize_error();

                            ScanaStudio.packet_view_add_packet( false,
                                                                channel,
                                                                uart_items[k-1].start_sample_index,
                                                                uart_items[k].end_sample_index,
                                                                "LRC",
                                                                dec_to_str(byte_value, "0x") + " Wrong, should be " +  dec_to_str(lrc, "0x"),
                                                                COLOR_T_ERROR,
                                                                COLOR_C_ERROR);
                        }

                        state_machine = ENUM_STATE_SOF;
                        break;
                    }//end case ENUM_STATE_LRC


                    default:
                    {
                        ScanaStudio.dec_item_new(   channel,
                                                    uart_items[k-1].start_sample_index,
                                                    uart_items[k].end_sample_index);
                        ScanaStudio.dec_item_add_content( "CODE SHOULD NEVER REACH THIS POINT ! " + dec_to_str(byte_value, "0x") );
                        ScanaStudio.dec_item_add_content( dec_to_str(byte_value, "0x") );
                        ScanaStudio.dec_item_emphasize_error();
                    }

                }//end switch state_machine


            }//end for k (here k should be eof-1)

            if( (uart_items[eof].content == "\r".charCodeAt()) && (uart_items[eof+1].content == "\n".charCodeAt()) )//End of Frame
            {
                ScanaStudio.dec_item_new(   channel,
                                            uart_items[eof].start_sample_index,
                                            uart_items[eof+1].end_sample_index);
                ScanaStudio.dec_item_add_content( "End of Frame : CR LF" );
                ScanaStudio.dec_item_add_content( "EOF : CR LF" );
                ScanaStudio.dec_item_add_content( "EOF" );
                ScanaStudio.packet_view_add_packet( false,
                                channel,
                                uart_items[eof].start_sample_index,
                                uart_items[eof+1].end_sample_index,
                                "EOF",
                                "CR LF",
                                "#0000FF",
                                "#8080FF");
            }


            i = eof;//repositionning the iterator
        }
    }//end for each uart item
}//end function decode for ASCII mode


function on_decode_signals(resume)
{
    //Write the decoder here
    if (!resume)
    {
        //initialization code
        reload_dec_gui_values();
        state_machine = ENUM_STATE_SOF;
        ScanaStudio.trs_reset(channel);
        trs = ScanaStudio.trs_get_next(channel);
        trame = [];
        current_byte_cnt = -1
        current_i_crc = -1;
        current_fct = -1;
        current_i_fct = -1;
        current_i_eof = -1
        too_short_silent = false;
        need_reinit_state_machine = false;

        i=0;
    }


    if(mode==0)//RTU mode
    {
        var uart_items = ScanaStudio.pre_decode("uart.js",resume);
        on_decode_signals_RTU_mode(uart_items);
    }
    else //ASCII mode
    {
        var uart_items = ScanaStudio.pre_decode("uart.js",resume);
        on_decode_signals_ASCII_mode(uart_items);
    }

}//end function decode signals


function on_build_demo_signals()
{
    var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
    var silence_period_samples = 1000 + (samples_to_build / 125);
    var uart_builder = ScanaStudio.load_builder_object("uart.js");
    reload_dec_gui_values();
    uart_builder.config(
                        channel,
                        baud,
                        Number(ScanaStudio.gui_get_value("nbits")), //nbits = 8 bits
                        parity,
                        Number(ScanaStudio.gui_get_value("stop")),
                        order,
                        invert,
                        Number(ScanaStudio.builder_get_sample_rate())
    );

    var my_builder = ScanaStudio.BuilderObject;
    my_builder.config( uart_builder );

    my_builder.put_silence(10);

    while( ScanaStudio.builder_get_samples_acc(channel) < samples_to_build )
    {
        var rng_mode = mode;
        var rng_addr = Math.floor(Math.random()*255) + 1;
        var rng_fct = Math.floor(Math.random()*10) + 1;
        var rng_request_answer = Math.floor(Math.random()*2);
        var rng_error_crc = Math.floor(Math.random()*20);
        var rng_ex_report = Math.floor(Math.random()*10);

        if(rng_fct>=7)
            rng_fct+=8;

        if(rng_mode == 0) //RTU
        {
            my_builder.put_silence(Math.floor(Math.random()*10) + 0);


            var RTU_data = [];
            RTU_data.push(rng_addr);

            if(rng_ex_report>1)//normal message
            {
                RTU_data.push(rng_fct);

                if((rng_fct==FCT_WRITE_SINGLE_COIL)||(rng_fct==FCT_WRITE_SINGLE_REGISTER))
                {
                    var rng_starting_addr = Math.floor(Math.random()*0xFFFF) + 1;
                    RTU_data.push( (rng_starting_addr >> 8) & 0xFF );
                    RTU_data.push( rng_starting_addr & 0xFF );

                    var rng_data_to_write = Math.floor(Math.random()*0xFFFF) + 1;
                    RTU_data.push( (rng_data_to_write >> 8) & 0xFF );
                    RTU_data.push( rng_data_to_write & 0xFF );
                }
                else if((rng_fct==FCT_WRITE_MULTIPLE_COILS)||(rng_fct==FCT_WRITE_MULTIPLE_REGISTERS))
                {
                    var rng_byte_count = Math.floor(Math.random()*30) + 1;
                    if(rng_byte_count%2)
                        rng_byte_count++;

                    var rng_starting_addr = Math.floor(Math.random()*0xFFFF) + 1;
                    RTU_data.push( (rng_starting_addr >> 8) & 0xFF );
                    RTU_data.push( rng_starting_addr & 0xFF );

                    var rng_quantity = Math.ceil(rng_byte_count/8);
                    RTU_data.push( (rng_quantity >> 8) & 0xFF );
                    RTU_data.push( rng_quantity & 0xFF );

                    if(rng_request_answer) //request
                    {
                        RTU_data.push( rng_byte_count );
                        var inc = 0;
                        for(inc =0; inc < rng_byte_count; inc++)
                        {
                            RTU_data.push( inc );
                        }
                    }
                    else //answer
                    {
                        //No more bytes
                    }
                }
                else
                {
                    if(rng_request_answer) //request
                    {
                        var rng_starting_addr = Math.floor(Math.random()*0xFFFF) + 1;
                        RTU_data.push( (rng_starting_addr >> 8) & 0xFF );
                        RTU_data.push( rng_starting_addr & 0xFF );

                        var rng_quantity_coils = Math.floor(Math.random()*0xFFFF) + 1;
                        RTU_data.push( (rng_quantity_coils >> 8) & 0xFF );
                        RTU_data.push( rng_quantity_coils & 0xFF );
                    }
                    else //answer
                    {
                        // var rng_byte_count_right
                        var rng_byte_count = Math.floor(Math.random()*10) + 1;

                        if((rng_fct==FCT_READ_HOLDING_REGISTERS)||(rng_fct==FCT_READ_INPUT_REGISTERS))
                        {
                            if(rng_byte_count%2)
                                rng_byte_count++;
                        }

                        RTU_data.push( rng_byte_count );
                        var inc = 0;
                        for(inc =0; inc < rng_byte_count; inc++)
                        {
                            RTU_data.push( inc );
                        }
                    }
                }
            }
            else
            {//execption frame
                var rng_ex = Math.floor(Math.random()*8)+1;
                rng_fct = rng_fct|0x80;
                RTU_data.push(rng_fct);
                RTU_data.push(rng_ex);
            }


            if(rng_error_crc>=1)
            {
                my_builder.modbus_RTU_write_data(RTU_data);
            }
            else// fake crc error
            {
                var crc = crc_calculation(RTU_data) + 1;
                var inc = 0;
            	for(inc=0;inc<RTU_data.length;inc++)
            	{
            		my_builder.uart_builder.put_c(RTU_data[inc]);
            	};

            	my_builder.uart_builder.put_c(crc&0xff);
            	my_builder.uart_builder.put_c(crc>>8);
            }
        }
        else //ASCII
        {
            my_builder.put_silence(Math.floor(Math.random()*10) + 0);
            var ASCII_data = "";

            ASCII_data += dec_to_str(rng_addr, "");


            if(rng_ex_report>1)
            {
                ASCII_data += dec_to_str(rng_fct, "");


                if((rng_fct==FCT_WRITE_SINGLE_COIL)||(rng_fct==FCT_WRITE_SINGLE_REGISTER))
                {
                    var rng_starting_addr_hi = Math.floor(Math.random()*0xFF);
                    var rng_starting_addr_lo = Math.floor(Math.random()*0xFF);
                    ASCII_data += dec_to_str(rng_starting_addr_hi, "");
                    ASCII_data += dec_to_str(rng_starting_addr_lo, "");

                    var rng_data_to_write_hi = Math.floor(Math.random()*0xFF);
                    var rng_data_to_write_lo = Math.floor(Math.random()*0xFF);
                    ASCII_data += dec_to_str(rng_data_to_write_hi, "");
                    ASCII_data += dec_to_str(rng_data_to_write_lo, "");
                }
                else if((rng_fct==FCT_WRITE_MULTIPLE_COILS)||(rng_fct==FCT_WRITE_MULTIPLE_REGISTERS))
                {
                    var rng_byte_count = Math.floor(Math.random()*30) + 1;
                    if(rng_byte_count%2 == 1)
                        rng_byte_count++;

                    var rng_starting_addr_hi = Math.floor(Math.random()*0xFF);
                    var rng_starting_addr_lo = Math.floor(Math.random()*0xFF);
                    ASCII_data += dec_to_str(rng_starting_addr_hi, "");
                    ASCII_data += dec_to_str(rng_starting_addr_lo, "");

                    var rng_quantity = Math.ceil(rng_byte_count/8);
                    ASCII_data += dec_to_str((rng_quantity >> 8) & 0xFF, "");
                    ASCII_data += dec_to_str(rng_quantity & 0xFF, "");

                    if(rng_request_answer) //request
                    {
                        ASCII_data += dec_to_str(rng_byte_count,"");
                        var inc = 0;
                        for(inc =0; inc < rng_byte_count; inc++)
                        {
                            ASCII_data += dec_to_str(inc,"");
                        }
                    }
                    else //answer
                    {
                        //No more bytes
                    }
                }
                else
                {
                    if(rng_request_answer) //request
                    {
                        var rng_starting_addr_hi = Math.floor(Math.random()*0xFF);
                        var rng_starting_addr_lo = Math.floor(Math.random()*0xFF);
                        ASCII_data += dec_to_str(rng_starting_addr_hi, "");
                        ASCII_data += dec_to_str(rng_starting_addr_lo, "");

                        var rng_quantity_coils_hi = Math.floor(Math.random()*0xFF);
                        var rng_quantity_coils_lo = Math.floor(Math.random()*0xFF);
                        ASCII_data += dec_to_str(rng_quantity_coils_hi, "");
                        ASCII_data += dec_to_str(rng_quantity_coils_lo, "");
                    }
                    else //answer
                    {
                        var rng_byte_count = Math.floor(Math.random()*10) + 1;

                        if((rng_fct==FCT_READ_HOLDING_REGISTERS)||(rng_fct==FCT_READ_INPUT_REGISTERS))
                        {
                            if(rng_byte_count%2)
                                rng_byte_count++;
                        }

                        ASCII_data += dec_to_str(rng_byte_count, "");
                        var inc = 0;
                        for(inc =0; inc < rng_byte_count; inc++)
                        {
                            ASCII_data += dec_to_str(inc, "");
                        }
                    }
                }
            }
            else
            {//execption frame
                var rng_ex = Math.floor(Math.random()*8)+1;
                rng_fct = rng_fct|0x80;
                ASCII_data += dec_to_str(rng_fct, "");
                ASCII_data += dec_to_str(rng_ex, "");
            }

            if(rng_error_crc>=1)
            {
                my_builder.modbus_ASCII_write_data(ASCII_data);
            }
            else// fake Lrc error
            {
                var i;
            	var lrc=0;
            	var temp = ":";

            	for(i=0;i<ASCII_data.length-1;i+=2)
            	{
            		temp += ASCII_data[i] + ASCII_data[i+1];
            		if(ASCII_data.charCodeAt(i) < 58)
            			lrc+= (ASCII_data.charCodeAt(i) - 0x30)*16;
            		else
            			lrc+= (ASCII_data.charCodeAt(i) - 55)*16;
            		if(ASCII_data.charCodeAt(i+1) < 58)
            			lrc+= ASCII_data.charCodeAt(i+1) - 0x30;
            		else
            			lrc+= ASCII_data.charCodeAt(i+1) - 55;
            	}

            	lrc = (-lrc)%256;
            	lrc = 256+lrc;
                lrc = lrc+1;

            	if (lrc < 0x10)
            	{
            		temp += "0";
            	}

            	temp += lrc.toString(16).toUpperCase() + "\r\n";

            	my_builder.uart_builder.put_str(temp);
            }
        }

    }//end while

    // my_builder.modbus_RTU_write_data([4,1,0,10,0,13]);
	// my_builder.modbus_ASCII_write_data("F7031389000A");
}



//Builder object that can be shared to other scripts
ScanaStudio.BuilderObject = {

    config : function(uart_builder)
    {
        this.uart_builder = uart_builder;
    },

    modbus_RTU_write_data : function(data)
    {
    	var i;
    	var crc = crc_calculation(data);

    	for(i=0;i<data.length;i++)
    	{
    		this.uart_builder.put_c(data[i]);
    	}

    	this.uart_builder.put_c(crc&0xff);
    	this.uart_builder.put_c(crc>>8);
    },

    modbus_ASCII_write_data : function(str)
    {
    	var i;
    	var lrc=0;
    	var temp = ":";

    	for(i=0;i<str.length-1;i+=2)
    	{
    		temp += str[i] + str[i+1];
    		if(str.charCodeAt(i) < 58)
    			lrc+= (str.charCodeAt(i) - 0x30)*16;
    		else
    			lrc+= (str.charCodeAt(i) - 55)*16;
    		if(str.charCodeAt(i+1) < 58)
    			lrc+= str.charCodeAt(i+1) - 0x30;
    		else
    			lrc+= str.charCodeAt(i+1) - 55;
    	}

    	lrc = (-lrc)%256;
    	lrc = 256+lrc;

    	if (lrc < 0x10)
    	{
    		temp += "0";
    	}

    	temp += lrc.toString(16).toUpperCase() + "\r\n";

    	this.uart_builder.put_str(temp);
    },

    put_silence : function(characters)
    {
        if(this.mode == 0)//RTU
        {
            ScanaStudio.builder_add_samples(this.uart_builder.channel, this.uart_builder.idle_level, this.uart_builder.samples_per_bit*characters*11);
        }
        else //ASCII
        {
            ScanaStudio.builder_add_samples(this.uart_builder.channel, this.uart_builder.idle_level, this.uart_builder.samples_per_bit*characters*11);
        }
    },
};

//OTHER FUNCTION
function function_to_str(fct_code, b_request)
{
    var str = "";
    if(b_request==-1)
    {
        str = "ERROR ";
    }

    switch(fct_code)
    {
        case FCT_READ_COIL_STATUS:
        {
            str += "Read Coils";
            break;
        }
        case FCT_READ_INPUT_STATUS:
        {
            str += "Read Discrete Inputs";
            break;
        }
        case FCT_READ_HOLDING_REGISTERS:
        {
            str += "Read Holding Registers";
            break;
        }
        case FCT_READ_INPUT_REGISTERS:
        {
            str += "Read Input Registers";
            break;
        }
        case FCT_WRITE_SINGLE_COIL:
        {
            str += "Write Single Coil";
            break;
        }
        case FCT_WRITE_SINGLE_REGISTER:
        {
            str += "Write Single Register";
            break;
        }
        case FCT_WRITE_MULTIPLE_COILS:
        {
            str += "Write Multiple Coils";
            break;
        }
        case FCT_WRITE_MULTIPLE_REGISTERS:
        {
            str += "Write Multiple Registers";
            break;
        }
    }

    if(b_request == 1)
    {
        str += " Request";
    }
    else if(b_request == 0)
    {
        str += " Answer";
    }

    return str;
}

function exception_to_str(ex_code)
{
    var str = "";
    switch(ex_code)
    {
        case ERROR_ILLEGAL_FUNCTION:
            str = "Illegal function";
        break;
        case ERROR_ILLEGAL_DATA_ADDRESS:
            str = "Illegal Data Address";
        break;
        case ERROR_ILLEGAL_DATA_VALUE:
            str = "Illegal Data Value";
        break;
        case ERROR_SERVER_DEVICE_FAILURE:
            str = "Server Device Failure";
        break;
        case ERROR_ACKNOWLEDGE:
            str = "Aknowledge";
        break;
        case ERROR_SERVER_DEVICE_BUSY:
            str = "Server Device Busy";
        break;
        case ERROR_MEMORY_PARITY_ERROR:
            str = "Memory Parity Error";
        break;
        case ERROR_GATEWAY_PATH_UNAVAILABLE:
            str = "Gateway Path Unavailable";
        break;
        case ERROR_GATEWAY_TARGET_DEVICE_FAILED_TO_RESPOND:
            str = "Gateway Target Device Failed to Respond";
        break;
        default :
            str = "Unknown exception";
        break;
    }

    return str;
}

function crc_calculation(trame)
{
	var crc = 0xFFFF;
	var pos;
	var j;

  	for (pos = 0; pos < trame.length; pos++)
	{
    	crc ^= trame[pos];

    	for (j = 8; j != 0; j--)
		{
      		if ((crc & 0x0001) != 0)
			{
        		crc >>= 1;
        		crc ^= 0xA001;
      		}
      		else
        		crc >>= 1;
    	}
  	}
  	return crc;
}

function dec_to_str(dec, prefix)
{
    var str = "";
    str += prefix;

    if(dec<16)
    {
        str+="0";
    }

    str += dec.toString(16).toUpperCase();

    return str;
}
