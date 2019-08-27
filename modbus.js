/* Protocol meta info:
<NAME> MODBUS </NAME>
<DESCRIPTION>

</DESCRIPTION>
<VERSION> 0.3 </VERSION>
<AUTHOR_NAME>  Nicolas BASTIT </AUTHOR_NAME>
<AUTHOR_URL> n.bastit@ikalogic.com </AUTHOR_URL>
<COPYRIGHT> Copyright Nicolas BASTIT </COPYRIGHT>
<LICENSE>  This code is distributed under the terms
of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.3: Updated packet view color palette
V0.2: Added dec_item_end() for each dec_item_new().
V0.1: Initial release.
</RELEASE_NOTES>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
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
var current_fct;
var current_i_fct;
var current_byte_cnt;
var trame = [];
var trame_started;
var trame_ended;
var last_item_end;
var available_samples;


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
        ENUM_STATE_EOF = 6,
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

    // for(j=0; j<uart_items.length; j++)
    // {
    //     ScanaStudio.dec_item_new(channel,uart_items[j].start_sample_index,uart_items[j].end_sample_index);
    //     ScanaStudio.dec_item_add_content(uart_items[j].content);
    //     ScanaStudio.dec_item_end();
    // }
    // return;

    var sample_per_bits = ScanaStudio.get_capture_sample_rate() / baud;
    for(j=0; (j<uart_items.length) && (!ScanaStudio.abort_is_requested()); j++)
    {
        if(!trame_started)
        {
            trame = [];
            if(j==0)
            {
                trame_started = true;
            }
            else if( (uart_items[j].start_sample_index - 1*sample_per_bits - 1.5*11*sample_per_bits) >= (uart_items[j-1].end_sample_index + 2*sample_per_bits) )
            {
                trame_started = true;
                last_item_end = uart_items[j-1].end_sample_index;
            }
        }

        if(trame_started)
        {
            if(j==uart_items.length-1)
            {
                if(uart_items[j].end_sample_index + 2*sample_per_bits <= available_samples-1.5*11*sample_per_bits )
                {
                    trame_ended = true;
                }
            }
            else
            {
                if( (uart_items[j+1].start_sample_index - 1*sample_per_bits - 1.5*11*sample_per_bits) >= (uart_items[j].end_sample_index + 2*sample_per_bits) )
                {
                    trame_ended = true;
                }
            }

            trame.push(uart_items[j]);

            if(trame_ended)//decode trame
            {
                trame_ended = false;
                trame_started = false;

                var i=0;
                var fct_code = 0x00;
                var request = false;
                var response = false;
                var error = false;
                var crc_reached = false;
                state_machine = ENUM_STATE_SLAVE_ADDR;
                for(i=0; (i<trame.length) && (!ScanaStudio.abort_is_requested()); i++)
                {
                    switch(state_machine)
                    {
                        case ENUM_STATE_SLAVE_ADDR:
                        {
                            if(last_item_end + 2*sample_per_bits + 3*11*sample_per_bits >= trame[i].start_sample_index - 1*sample_per_bits)
                            {
                                ScanaStudio.dec_item_new( channel,
                                                        last_item_end + 2*sample_per_bits,
                                                        trame[i].start_sample_index - 1*sample_per_bits);
                                ScanaStudio.dec_item_add_content( "Too short Start Of Frame" );
                                ScanaStudio.dec_item_add_content( "!Start Of Frame" );
                                ScanaStudio.dec_item_add_content( "!SOF" );
                                ScanaStudio.dec_item_emphasize_warning();
                                ScanaStudio.dec_item_end();
                            }
                            else
                            {
                                ScanaStudio.dec_item_new( channel,
                                                        trame[i].start_sample_index - 3*11*sample_per_bits - 3*sample_per_bits,
                                                        trame[i].start_sample_index - 1*sample_per_bits);
                                ScanaStudio.dec_item_add_content( "Start Of Frame" );
                                ScanaStudio.dec_item_add_content( "SOF" );
                                ScanaStudio.dec_item_end();
                            }
                            ScanaStudio.dec_item_new( channel,
                                                    trame[i].start_sample_index,
                                                    trame[i].end_sample_index);
                            ScanaStudio.dec_item_add_content( "Slave Address : " + trame[i].content );
                            ScanaStudio.dec_item_add_content( "Slave Addr: " + trame[i].content );
                            ScanaStudio.dec_item_add_content( "Addr:" + trame[i].content );
                            ScanaStudio.dec_item_add_content( trame[i].content );
                            ScanaStudio.dec_item_end();

                            ScanaStudio.packet_view_add_packet( true,
                                                                channel,
                                                                trame[i].start_sample_index,
                                                                trame[trame.length-1].end_sample_index,
                                                                "Modbus RTU",
                                                                "CH" + (channel + 1),
                                                                ScanaStudio.get_channel_color(channel),
                                                                ScanaStudio.get_channel_color(channel));
                            ScanaStudio.packet_view_add_packet( false,
                                                                channel,
                                                                trame[i].start_sample_index,
                                                                trame[i].end_sample_index,
                                                                "Slave Addr:",
                                                                "@" + trame[i].content,
                                                                ScanaStudio.PacketColors.Preamble.Title,
                                                                ScanaStudio.PacketColors.Preamble.Content);
                            state_machine = ENUM_STATE_FUNCTION;
                            break;
                        }//end ENUM_STATE_SLAVE_ADDR

                        case ENUM_STATE_FUNCTION:
                        {
                            fct_code = Number( trame[i].content );

                            ScanaStudio.dec_item_new( channel,
                                                    trame[i].start_sample_index,
                                                    trame[i].end_sample_index);
                            switch(fct_code)
                            {
                                case FCT_READ_COIL_STATUS:
                                case FCT_READ_INPUT_STATUS:
                                case FCT_READ_HOLDING_REGISTERS:
                                case FCT_READ_INPUT_REGISTERS:
                                {
                                    if(trame.length > 3)
                                    {
                                        if(trame.length-5 == Number(trame[2].content))
                                        {
                                            response = true;
                                            request = false;
                                        }
                                        else if(trame.length == 8)
                                        {
                                            request = true;
                                            response = false;
                                        }
                                    }
                                    break;
                                }

                                case FCT_WRITE_SINGLE_COIL:
                                case FCT_WRITE_SINGLE_REGISTER:
                                {
                                    if(trame.length == 8)
                                    {
                                        request = true;
                                        response = false;
                                    }
                                    break;
                                }

                                case FCT_WRITE_MULTIPLE_COILS:
                                case FCT_WRITE_MULTIPLE_REGISTERS:
                                {
                                    if(trame.length >= 7)
                                    {
                                        if(trame.length-9 == Number(trame[6].content))
                                        {
                                            request = true;
                                            response = false;
                                        }
                                        else if(trame.length == 8)
                                        {
                                            response = true;
                                            request = false;
                                        }
                                    }
                                    break;
                                }

                                default:
                                {
                                    if((trame.length == 5)&&(fct_code&0x80))//exception
                                    {
                                         error = true;
                                    }
                                    else
                                    {
                                        //unknown function
                                    }
                                }

                            }//end switch fct_code
                            var fct_type_dec = -2;
                            if(error)
                            {
                                fct_type_dec = -1;
                                ScanaStudio.dec_item_emphasize_warning();
                            }
                            else if(request && !response)
                            {
                                fct_type_dec = 1;
                            }
                            else if(!request && response)
                            {
                                fct_type_dec = 0;
                            }
                            ScanaStudio.dec_item_add_content( "Function : " + function_to_str(fct_code&0x7F,fct_type_dec) );
                            ScanaStudio.dec_item_add_content( "Fct : " + function_to_str(fct_code&0x7F,fct_type_dec) );
                            ScanaStudio.dec_item_add_content( "Fct : " + trame[i].content );
                            ScanaStudio.dec_item_add_content( trame[i].content );
                            ScanaStudio.dec_item_end();

                            ScanaStudio.packet_view_add_packet( false,
                                                                channel,
                                                                trame[i].start_sample_index,
                                                                trame[i].end_sample_index,
                                                                "Function",
                                                                function_to_str(fct_code&0x7F,fct_type_dec),
                                                                (error ? ScanaStudio.PacketColors.Error.Title : ScanaStudio.PacketColors.Misc.Title),
                                                                (error ? ScanaStudio.PacketColors.Error.Content : ScanaStudio.PacketColors.Misc.Content));

                            state_machine = ENUM_STATE_AFTER_FUNCTION;
                            break;
                        }//end ENUM_STATE_FUNCTION

                        case ENUM_STATE_AFTER_FUNCTION:
                        {
                            ScanaStudio.dec_item_new( channel,
                                                    trame[i].start_sample_index,
                                                    trame[i].end_sample_index);

                            var pkt_str = "";
                            var exception_code = 0;
                            switch(fct_code)//fill dec_items and packet view
                            {
                                case FCT_READ_COIL_STATUS:
                                {
                                    if(request && !response)
                                    {
                                        switch(i)
                                        {
                                            case 2://Starting Address Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Starting Address Hi : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Hi : " + trame[i].content);
                                                pkt_str = "Starting @ Hi";
                                                break;
                                            }
                                            case 3://Starting Address Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Starting Address Lo : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Lo : " + trame[i].content);
                                                pkt_str = "Starting @ Lo";
                                                break;
                                            }
                                            case 4://Quantity of Coils Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Coils Hi : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Hi : " + trame[i].content);
                                                pkt_str = "Qty Coils Hi";
                                                break;
                                            }
                                            case 5://Quantity of Coils Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Coils Lo : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Lo : " + trame[i].content);
                                                pkt_str = "Qty Coils Lo";
                                                break;
                                            }
                                            default://warning
                                            {
                                                ScanaStudio.dec_item_emphasize_warning();
                                                pkt_str = "Data";
                                                break;
                                            }
                                        }
                                    }
                                    else if(!request && response)
                                    {
                                        switch(i)
                                        {
                                            case 2://Byte Count
                                            {
                                                ScanaStudio.dec_item_add_content("Byte Count : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Cnt : " + trame[i].content);
                                                pkt_str = "Cnt";
                                                break;
                                            }
                                            default://data and warning
                                            {
                                                if((i-3< Number(trame[2].content))&&(i-3>=0))
                                                {
                                                    ScanaStudio.dec_item_add_content("Data : " + trame[i].content);
                                                    pkt_str = "Data";
                                                }
                                                else
                                                {
                                                    ScanaStudio.dec_item_emphasize_warning();
                                                    pkt_str = "Data";
                                                }
                                                break;
                                            }
                                        }
                                    }
                                    else
                                    {
                                        //warning
                                        ScanaStudio.dec_item_emphasize_error();
                                        // pkt_str = "Data";
                                    }
                                    break;
                                }//end FCT_READ_COIL_STATUS datas

                                case FCT_READ_INPUT_STATUS:
                                {
                                    if(request && !response)
                                    {
                                        switch(i)
                                        {
                                            case 2://Starting Address Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Starting Address Hi : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Hi : " + trame[i].content);
                                                pkt_str = "Starting @ Hi";
                                                break;
                                            }
                                            case 3://Starting Address Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Starting Address Lo : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Lo : " + trame[i].content);
                                                pkt_str = "Starting @ Lo";
                                                break;
                                            }
                                            case 4://Quantity of Inputs Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Inputs Hi : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Hi : " + trame[i].content);
                                                pkt_str = "Qty In Hi";
                                                break;
                                            }
                                            case 5://Quantity of Inputs Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Inputs Lo : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Lo : " + trame[i].content);
                                                pkt_str = "Qty In Lo";
                                                break;
                                            }
                                            default://warning
                                            {
                                                ScanaStudio.dec_item_emphasize_warning();
                                                pkt_str = "Data";
                                                break;
                                            }
                                        }
                                    }
                                    else if(!request && response)
                                    {
                                        switch(i)
                                        {
                                            case 2://Byte Count
                                            {
                                                ScanaStudio.dec_item_add_content("Byte Count : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Cnt : " + trame[i].content);
                                                pkt_str = "Cnt";
                                                break;
                                            }
                                            default://data and warning
                                            {
                                                if((i-3< Number(trame[2].content))&&(i-3>=0))
                                                {
                                                    ScanaStudio.dec_item_add_content("Data : " + trame[i].content);
                                                    pkt_str = "Data";
                                                }
                                                else
                                                {
                                                    ScanaStudio.dec_item_emphasize_warning();
                                                    pkt_str = "Data";
                                                }
                                                break;
                                            }
                                        }
                                    }
                                    else
                                    {
                                        //warning
                                        ScanaStudio.dec_item_emphasize_error();
                                        // pkt_str = "Data";
                                    }
                                    break;
                                }//end FCT_READ_INPUT_STATUS datas

                                case FCT_READ_HOLDING_REGISTERS:
                                case FCT_READ_INPUT_REGISTERS:
                                {
                                    if(request && !response)
                                    {
                                        switch(i)
                                        {
                                            case 2://Starting Address Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Starting Address Hi : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Hi : " + trame[i].content);
                                                pkt_str = "Starting @ Hi";
                                                break;
                                            }
                                            case 3://Starting Address Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Starting Address Lo : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Lo : " + trame[i].content);
                                                pkt_str = "Starting @ Lo";
                                                break;
                                            }
                                            case 4://Quantity of Register Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Register Hi : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Hi : " + trame[i].content);
                                                pkt_str = "Qty Register @ Hi";
                                                break;
                                            }
                                            case 5://Quantity of Register Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Register Lo : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Lo : " + trame[i].content);
                                                pkt_str = "Qty Reg @ Lo";
                                                break;
                                            }
                                            default://warning
                                            {
                                                ScanaStudio.dec_item_emphasize_warning();
                                                pkt_str = "Data";
                                                break;
                                            }
                                        }
                                    }
                                    else if(!request && response)
                                    {
                                        switch(i)
                                        {
                                            case 2://Byte Count
                                            {
                                                ScanaStudio.dec_item_add_content("Byte Count : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Cnt : " + trame[i].content);
                                                pkt_str = "Cnt";
                                                break;
                                            }
                                            default://data and warning     if i%2 == 1 => Data Hi     else Data Lo
                                            {
                                                if((i-3< Number(trame[2].content))&&(i-3>=0))
                                                {
                                                    if(i%2)
                                                    {
                                                        ScanaStudio.dec_item_add_content("Data Hi : " + trame[i].content);
                                                        pkt_str = "Data Hi";
                                                    }
                                                    else
                                                    {
                                                        ScanaStudio.dec_item_add_content("Data Lo : " + trame[i].content);
                                                        pkt_str = "Data Lo";
                                                    }
                                                }
                                                else
                                                {
                                                    ScanaStudio.dec_item_emphasize_warning();
                                                    pkt_str = "Data";
                                                }
                                                break;
                                            }
                                        }
                                    }
                                    else
                                    {
                                        //warning
                                        ScanaStudio.dec_item_emphasize_error();
                                        // pkt_str = "Data";
                                    }
                                    break;
                                }//end FCT_READ_HOLDING_REGISTERS and FCT_READ_INPUT_REGISTERS datas

                                case FCT_WRITE_SINGLE_COIL:
                                {
                                    if(trame.length == 8)
                                    {
                                        switch(i)
                                        {
                                            case 2://Coil Address Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Coil Address Hi : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Hi : " + trame[i].content);
                                                pkt_str = "Coil @ Hi";
                                                break;
                                            }
                                            case 3://Coil Address Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Coil Address Lo : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Lo : " + trame[i].content);
                                                pkt_str = "Coil @ Lo";
                                                break;
                                            }
                                            case 4://Write Data Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Write Data Hi : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Hi : " + trame[i].content);
                                                pkt_str = "Wr Data Hi";
                                                break;
                                            }
                                            case 5://Write Data Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Write Data Lo : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Lo : " + trame[i].content);
                                                pkt_str = "Wr Data Lo";
                                                break;
                                            }
                                            default://warning
                                            {
                                                ScanaStudio.dec_item_emphasize_warning();
                                                pkt_str = "Data";
                                                break;
                                            }
                                        }
                                    }
                                    else
                                    {
                                        //warning
                                        ScanaStudio.dec_item_emphasize_error();
                                        // pkt_str = "Data";
                                    }
                                    break;
                                }//end FCT_WRITE_SINGLE_COIL datas

                                case FCT_WRITE_SINGLE_REGISTER:
                                {
                                    if(trame.length == 8)
                                    {
                                        switch(i)
                                        {
                                            case 2://Register Address Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Register Address Hi : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Hi : " + trame[i].content);
                                                pkt_str = "Reg @ Hi";
                                                break;
                                            }
                                            case 3://Register Address Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Register Address Lo : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Lo : " + trame[i].content);
                                                pkt_str = "Reg @ Lo";
                                                break;
                                            }
                                            case 4://Write Data Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Write Data Hi : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Hi : " + trame[i].content);
                                                pkt_str = "Wr Data Hi";
                                                break;
                                            }
                                            case 5://Write Data Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Write Data Lo : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Lo : " + trame[i].content);
                                                pkt_str = "Wr Data Lo";
                                                break;
                                            }
                                            default://warning
                                            {
                                                ScanaStudio.dec_item_emphasize_warning();
                                                pkt_str = "Data";
                                                break;
                                            }
                                        }
                                    }
                                    else
                                    {
                                        //warning
                                        ScanaStudio.dec_item_emphasize_error();
                                        // pkt_str = "Data";
                                    }
                                    break;
                                }//end FCT_WRITE_SINGLE_COIL datas

                                case FCT_WRITE_MULTIPLE_COILS:
                                {
                                    if(request && !response)
                                    {
                                        switch(i)
                                        {
                                            case 2://Coil Address Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Coil Address Hi : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Hi : " + trame[i].content);
                                                pkt_str = "Coil @ Hi";
                                                break;
                                            }
                                            case 3://Coil Address Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Coil Address Lo : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Lo : " + trame[i].content);
                                                pkt_str = "Coil @ Lo";
                                                break;
                                            }
                                            case 4://Quantity of Coil Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Coil Hi : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Hi : " + trame[i].content);
                                                pkt_str = "Qty Hi";
                                                break;
                                            }
                                            case 5://Quantity of Coil Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Coil Lo : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Lo : " + trame[i].content);
                                                pkt_str = "Qty Lo";
                                                break;
                                            }
                                            case 6://byte Count
                                            {
                                                ScanaStudio.dec_item_add_content("Byte Count : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Cnt : " + trame[i].content);
                                                pkt_str = "Cnt";
                                                break;
                                            }
                                            default://warning and data    if i%2 == 1 => Data Hi    else Data Lo
                                            {
                                                if((i-7< Number(trame[6].content))&&(i-7>=0))
                                                {
                                                    if(i%2)
                                                    {
                                                        ScanaStudio.dec_item_add_content("Data Hi : " + trame[i].content);
                                                        pkt_str = "Data Hi";
                                                    }
                                                    else
                                                    {
                                                        ScanaStudio.dec_item_add_content("Data Lo : " + trame[i].content);
                                                        pkt_str = "Data Lo";
                                                    }
                                                }
                                                else
                                                {
                                                    ScanaStudio.dec_item_emphasize_warning();
                                                    pkt_str = "Data";
                                                }
                                                break;
                                            }
                                        }
                                    }
                                    else if(!request && response)
                                    {
                                        switch(i)
                                        {
                                            case 2://Coil Address Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Coil Address Hi : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Hi : " + trame[i].content);
                                                pkt_str = "Coil @ Hi";
                                                break;
                                            }
                                            case 3://Coil Address Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Coil Address Lo : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Lo : " + trame[i].content);
                                                pkt_str = "Coil @ Lo";
                                                break;
                                            }
                                            case 4://Quantity of Coil Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Coil Hi : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Hi : " + trame[i].content);
                                                pkt_str = "Qty Hi";
                                                break;
                                            }
                                            case 5://Quantity of Coil Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Coil Lo : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Lo : " + trame[i].content);
                                                pkt_str = "Qty Lo";
                                                break;
                                            }
                                            default://warning
                                            {
                                                ScanaStudio.dec_item_emphasize_warning();
                                                pkt_str = "Data";
                                            }
                                        }
                                    }
                                    else
                                    {
                                        //warning
                                        ScanaStudio.dec_item_emphasize_error();
                                        // pkt_str = "Data";
                                    }
                                    break;
                                }//end FCT_WRITE_MULTIPLE_COILS datas

                                case FCT_WRITE_MULTIPLE_REGISTERS:
                                {
                                    if(request && !response)
                                    {
                                        switch(i)
                                        {
                                            case 2://Starting Address Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Starting Address Hi : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Hi : " + trame[i].content);
                                                pkt_str = "Starting @ Hi";
                                                break;
                                            }
                                            case 3://Starting Address Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Starting Address Lo : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Lo : " + trame[i].content);
                                                pkt_str = "Starting @ Lo";
                                                break;
                                            }
                                            case 4://Quantity of Registers Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Registers Hi : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Hi : " + trame[i].content);
                                                pkt_str = "Qty Reg Hi";
                                                break;
                                            }
                                            case 5://Quantity of Registers Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Registers Lo : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Lo : " + trame[i].content);
                                                pkt_str = "Qty Reg Lo";
                                                break;
                                            }
                                            case 6://Byte Count
                                            {
                                                ScanaStudio.dec_item_add_content("Byte Count : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Cnt : " + trame[i].content);
                                                pkt_str = "Cnt";
                                                break;
                                            }
                                            default://warning and data    if i%2 == 1 => Data Hi    else Data Lo
                                            {
                                                if((i-7< Number(trame[6].content))&&(i-7>=0))
                                                {
                                                    if(i%2)
                                                    {
                                                        ScanaStudio.dec_item_add_content("Data Hi : " + trame[i].content);
                                                        pkt_str = "Data Hi";
                                                    }
                                                    else
                                                    {
                                                        ScanaStudio.dec_item_add_content("Data Lo : " + trame[i].content);
                                                        pkt_str = "Data Lo";
                                                    }
                                                }
                                                else
                                                {
                                                    ScanaStudio.dec_item_emphasize_warning();
                                                    pkt_str = "Data";
                                                }
                                                break;
                                            }
                                        }
                                    }
                                    else if(!request && response)
                                    {
                                        switch(i)
                                        {
                                            case 2://Starting Address Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Starting Address Hi : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Hi : " + trame[i].content);
                                                pkt_str = "Starting @ Hi";
                                                break;
                                            }
                                            case 3://Starting Address Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Starting Address Lo : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Lo : " + trame[i].content);
                                                pkt_str = "Starting @ Lo";
                                                break;
                                            }
                                            case 4://Quantity of Registers Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Registers Hi : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Hi : " + trame[i].content);
                                                pkt_str = "Qty Reg Hi";
                                                break;
                                            }
                                            case 5://Quantity of Registers Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Registers Lo : " + trame[i].content);
                                                ScanaStudio.dec_item_add_content("Lo : " + trame[i].content);
                                                pkt_str = "Qty Reg Lo";
                                                break;
                                            }
                                            default://warning
                                            {
                                                ScanaStudio.dec_item_emphasize_warning();
                                                pkt_str = "Data";
                                            }
                                        }
                                    }
                                    else
                                    {
                                        //warning
                                        ScanaStudio.dec_item_emphasize_error();
                                        // pkt_str = "Data";
                                    }
                                    break;
                                }//end FCT_WRITE_MULTIPLE_REGISTERS datas

                                default:
                                {
                                    if((trame.length == 5)&&(fct_code&0x80))//exception
                                    {
                                        exception_code = Number(trame[i].content);
                                        ScanaStudio.dec_item_add_content("Exception : " + exception_to_str(exception_code&0x7F));
                                        ScanaStudio.dec_item_add_content("Ex : " + exception_to_str(exception_code&0x7F));
                                        ScanaStudio.dec_item_add_content("Ex : " + trame[i].content);
                                        pkt_str = "Exception";
                                        ScanaStudio.dec_item_emphasize_warning();
                                    }
                                    else
                                    {
                                        ScanaStudio.dec_item_add_content("Unknown data : " + trame[i].content);
                                        pkt_str = "Unknown";
                                    }
                                }
                            }//end switch fct for datas

                            ScanaStudio.dec_item_add_content( trame[i].content );
                            ScanaStudio.dec_item_end();

                            ScanaStudio.packet_view_add_packet( false,
                                                                channel,
                                                                trame[i].start_sample_index,
                                                                trame[i].end_sample_index,
                                                                pkt_str,
                                                                (exception_code != 0) ? exception_to_str(exception_code&0x7F) : trame[i].content,
                                                                (exception_code != 0) ? ScanaStudio.PacketColors.Error.Title : ScanaStudio.PacketColors.Data.Title,
                                                                (exception_code != 0) ? ScanaStudio.PacketColors.Error.Content : ScanaStudio.PacketColors.Data.Content);
                            if(i == trame.length - 3)
                            {
                                state_machine = ENUM_STATE_CRC;
                            }
                            break;
                        }//end ENUM_STATE_AFTER_FUNCTION

                        case ENUM_STATE_CRC:
                        {
                            if(!crc_reached)
                            {
                                crc_reached = true;
                                break;
                            }

                            var crc_red = ((Number(trame[i].content)<<8)&0xFF00) | (Number(trame[i-1].content)&0x00FF);
                            var tmp_trame = [];
                            for(var k=0; k<trame.length-2; k++)
                            {
                                tmp_trame.push(trame[k].content);
                            }
                            var crc_calculated = crc_calculation(tmp_trame);

                            var crc_str = "0x";
                            if (crc_red < 0x10)
                            {
                                crc_str += "0";
                            }
                            crc_str += crc_red.toString(16);

                            ScanaStudio.dec_item_new( channel,
                                                    trame[i-1].start_sample_index,
                                                    trame[i].end_sample_index);
                            if(crc_red == crc_calculated)
                            {
                                ScanaStudio.dec_item_add_content( "CRC OK : " + crc_str );
                                ScanaStudio.dec_item_add_content( "CRC " + crc_str );
                                ScanaStudio.dec_item_add_content( crc_str );

                                ScanaStudio.packet_view_add_packet( false,
                                                                    channel,
                                                                    trame[i-1].start_sample_index,
                                                                    trame[i].end_sample_index,
                                                                    "CRC",
                                                                    crc_str + " OK",
                                                                    ScanaStudio.PacketColors.Check.Title,
                                                                    ScanaStudio.PacketColors.Check.Content);
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
                                                                    trame[i-1].start_sample_index,
                                                                    trame[i].end_sample_index,
                                                                    "CRC",
                                                                    crc_str + " Wrong, should be " + crc_c_str,
                                                                    ScanaStudio.PacketColors.Error.Title,
                                                                    ScanaStudio.PacketColors.Error.Content);
                            }
                            ScanaStudio.dec_item_end();
                            break;
                        }//end ENUM_STATE_CRC
                    }// end switch state_machine
                }//end for i in trame
            }//end if trame ended
        }//end if trame started
    }//end for j in uart_item
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

    // for(j=0; j<uart_items.length; j++)
    // {
    //     ScanaStudio.dec_item_new(channel,uart_items[j].start_sample_index,uart_items[j].end_sample_index);
    //     ScanaStudio.dec_item_add_content(uart_items[j].content);
    //     ScanaStudio.dec_item_end();
    // }
    // return;

    var sample_per_bits = ScanaStudio.get_capture_sample_rate() / baud;
    for(j=0; (j<uart_items.length) && (!ScanaStudio.abort_is_requested()); j++)
    {
        if(!trame_started)
        {
            trame = [];
            if(uart_items[j].content == ":".charCodeAt())
            {
                trame_started = true;
            }
        }

        if(trame_started)
        {
            trame.push(uart_items[j]);

            if(j==uart_items.length-1)
            {
                if(j>=1 )
                {
                    if( (uart_items[j-1].content == "\r".charCodeAt()) && (uart_items[j].content == "\n".charCodeAt()) )
                    {
                        trame_ended = true;
                    }
                }
                else if(uart_items[j].end_sample_index <= available_samples-1*ScanaStudio.get_capture_sample_rate() )//1s between 2 char
                {
                    trame_ended = true;
                }
            }
            else
            {
                if( uart_items[j+1].start_sample_index  >= uart_items[j].end_sample_index + 1*ScanaStudio.get_capture_sample_rate() )
                {
                    trame_ended = true;
                }
                else if(j>=1 )
                {
                    if( (uart_items[j-1].content == "\r".charCodeAt()) && (uart_items[j].content == "\n".charCodeAt()) )
                    {
                        trame_ended = true;
                        // trame.push(uart_items[j+1]);
                    }
                }
            }

            if(trame_ended)//decode trame
            {
                trame_ended = false;
                trame_started = false;


                var i=0;
                var fct_code = 0x00;
                var request = false;
                var response = false;
                var error = false;
                var lrc_reached = false;
                var lrc = 0;
                state_machine = ENUM_STATE_SLAVE_ADDR;
                for(i=0; (i<trame.length) && (!ScanaStudio.abort_is_requested()); i++)
                {
                    if(i==0)//start ":"
                    {
                        if(trame[i].content == ":".charCodeAt())
                        {
                            ScanaStudio.packet_view_add_packet( true,
                                                                channel,
                                                                trame[i].start_sample_index,
                                                                trame[trame.length-1].end_sample_index,
                                                                "Modbus ASCII",
                                                                "CH" + (channel + 1),
                                                                "#0000FF",
                                                                ScanaStudio.get_channel_color(channel));//"#8080FF");
                            ScanaStudio.packet_view_add_packet( false,
                                                                channel,
                                                                trame[i].start_sample_index,
                                                                trame[i].end_sample_index,
                                                                "SOF",
                                                                String.fromCharCode(trame[i].content),
                                                                "#0000FF",
                                                                "#8080FF");

                            ScanaStudio.dec_item_new( channel,
                                                    trame[i].start_sample_index,
                                                    trame[i].end_sample_index);
                            ScanaStudio.dec_item_add_content( "Start Of Frame" );
                            ScanaStudio.dec_item_add_content( "SOF : ':'" );
                            ScanaStudio.dec_item_add_content( "':'" );
                            ScanaStudio.dec_item_end();
                            continue;
                        }
                        else
                        {
                            ScanaStudio.packet_view_add_packet( true,
                                                    channel,
                                                    trame[i].start_sample_index,
                                                    trame[i].end_sample_index,
                                                    "!SOF",
                                                    String.fromCharCode(trame[i].content),
                                                    ScanaStudio.PacketColors.Error.Title,
                                                    ScanaStudio.PacketColors.Error.Title);
                            break;
                        }
                    }
                    else if(i==trame.length-2)
                    {
                        if( (trame[i].content == "\r".charCodeAt()) && (trame[i+1].content == "\n".charCodeAt()) )//End of Frame
                        {
                            ScanaStudio.dec_item_new(   channel,
                                                        trame[i].start_sample_index,
                                                        trame[i+1].end_sample_index);
                            ScanaStudio.dec_item_add_content( "End of Frame : CR LF" );
                            ScanaStudio.dec_item_add_content( "EOF : CR LF" );
                            ScanaStudio.dec_item_add_content( "EOF" );
                            ScanaStudio.dec_item_end();

                            ScanaStudio.packet_view_add_packet( false,
                                            channel,
                                            trame[i].start_sample_index,
                                            trame[i+1].end_sample_index,
                                            "EOF",
                                            "CR LF",
                                            "#0000FF",
                                            "#8080FF");
                        }
                    }

                    var tmp_val; //char value detection
                    if( (trame[i].content >= 0x30) && (trame[i].content <= 0x39) ) //0-9
                    {
                        tmp_val = trame[i].content - 0x30;
                    }
                    else if( (trame[i].content >= 0x41) && (trame[i].content <= 0x46) ) //A-F
                    {
                        tmp_val = trame[i].content - 0x41 + 10;
                    }
                    else if( (trame[i].content >= 0x61) && (trame[i].content <= 0x66) ) //A-F
                    {
                        tmp_val = trame[i].content - 0x61 + 10;
                    }
                    else if((trame[i].content == "\r".charCodeAt()) || (trame[i].content == "\n".charCodeAt()))
                    {
                        tmp_val = 0;
                    }
                    else
                    {
                        ScanaStudio.dec_item_new(   channel,
                                                    trame[i].start_sample_index,
                                                    trame[i].end_sample_index);
                        ScanaStudio.dec_item_add_content( "Unknown char code :'" + String.fromCharCode(trame[i].content) + "' " + trame[i].content );
                        ScanaStudio.dec_item_add_content( "'" + String.fromCharCode(trame[i].content) + "' " + trame[i].content );
                        ScanaStudio.dec_item_add_content( trame[i].content );
                        ScanaStudio.dec_item_emphasize_warning();
                        ScanaStudio.dec_item_end();
                    }


                    if( i%2 == 1 ) //first byte
                    {
                        byte_value = tmp_val * 16;
                        continue;
                    }
                    else( i%2 == 0 )
                    {
                        byte_value += tmp_val;
                    }


                    switch(state_machine)//start of decoding of the frame
                    {
                        case ENUM_STATE_SLAVE_ADDR:
                        {
                            ScanaStudio.dec_item_new( channel,
                                                    trame[i-1].start_sample_index,
                                                    trame[i].end_sample_index);
                            ScanaStudio.dec_item_add_content( "Slave Address : " + dec_to_str(byte_value, "0x") );
                            ScanaStudio.dec_item_add_content( "Slave Addr: " + dec_to_str(byte_value, "0x") );
                            ScanaStudio.dec_item_add_content( "Addr:" + dec_to_str(byte_value, "0x") );
                            ScanaStudio.dec_item_add_content( dec_to_str(byte_value, "0x") );
                            ScanaStudio.dec_item_end();

                            ScanaStudio.packet_view_add_packet( false,
                                                                channel,
                                                                trame[i-1].start_sample_index,
                                                                trame[i].end_sample_index,
                                                                "Slave Addr:",
                                                                "@" + dec_to_str(byte_value, "0x"),
                                                                ScanaStudio.PacketColors.Preamble.Title,
                                                                ScanaStudio.PacketColors.Preamble.Content);
                            lrc += byte_value;
                            state_machine = ENUM_STATE_FUNCTION;
                            break;
                        }//end ENUM_STATE_SLAVE_ADDR

                        case ENUM_STATE_FUNCTION:
                        {
                            fct_code = byte_value;
                            lrc += byte_value;

                            ScanaStudio.dec_item_new( channel,
                                                    trame[i-1].start_sample_index,
                                                    trame[i].end_sample_index);
                            switch(fct_code)
                            {
                                case FCT_READ_COIL_STATUS:
                                case FCT_READ_INPUT_STATUS:
                                case FCT_READ_HOLDING_REGISTERS:
                                case FCT_READ_INPUT_REGISTERS:
                                {
                                    if(trame.length > 7)
                                    {
                                        if( (trame.length-11)/2 == (str_to_hex(trame[5].content)*16 +  str_to_hex(trame[6].content)) )
                                        {
                                            response = true;
                                            request = false;
                                        }
                                        else if(trame.length == 17)
                                        {
                                            request = true;
                                            response = false;
                                        }
                                    }
                                    break;
                                }

                                case FCT_WRITE_SINGLE_COIL:
                                case FCT_WRITE_SINGLE_REGISTER:
                                {
                                    if(trame.length == 17)
                                    {
                                        request = true;
                                        response = false;
                                    }
                                    break;
                                }

                                case FCT_WRITE_MULTIPLE_COILS:
                                case FCT_WRITE_MULTIPLE_REGISTERS:
                                {
                                    if(trame.length >= 15)
                                    {
                                        if( (trame.length-19)/2 == (str_to_hex(trame[13].content)*16 +  str_to_hex(trame[14].content)) )
                                        {
                                            request = true;
                                            response = false;
                                        }
                                        else if(trame.length == 17)
                                        {
                                            response = true;
                                            request = false;
                                        }
                                    }
                                    break;
                                }

                                default:
                                {
                                    if((trame.length == 11)&&(fct_code&0x80))//exception
                                    {
                                         error = true;
                                    }
                                    else
                                    {
                                        //unknown function
                                    }
                                }

                            }//end switch fct_code
                            var fct_type_dec = -2;
                            if(error)
                            {
                                fct_type_dec = -1;
                                ScanaStudio.dec_item_emphasize_warning();
                            }
                            else if(request && !response)
                            {
                                fct_type_dec = 1;
                            }
                            else if(!request && response)
                            {
                                fct_type_dec = 0;
                            }
                            ScanaStudio.dec_item_add_content( "Function : " + function_to_str(fct_code&0x7F,fct_type_dec) );
                            ScanaStudio.dec_item_add_content( "Fct : " + function_to_str(fct_code&0x7F,fct_type_dec) );
                            ScanaStudio.dec_item_add_content( "Fct : " + dec_to_str(byte_value, "0x") );
                            ScanaStudio.dec_item_add_content( dec_to_str(byte_value, "0x") );
                            ScanaStudio.dec_item_end();
                            ScanaStudio.packet_view_add_packet( false,
                                                                channel,
                                                                trame[i-1].start_sample_index,
                                                                trame[i].end_sample_index,
                                                                "Function",
                                                                function_to_str(fct_code&0x7F,fct_type_dec),
                                                                (error ? ScanaStudio.PacketColors.Error.Title : ScanaStudio.PacketColors.Misc.Title),
                                                                (error ? ScanaStudio.PacketColors.Error.Content : ScanaStudio.PacketColors.Misc.Content));

                            state_machine = ENUM_STATE_AFTER_FUNCTION;
                            break;
                        }//end ENUM_STATE_FUNCTION

                        case ENUM_STATE_AFTER_FUNCTION:
                        {
                            ScanaStudio.dec_item_new( channel,
                                                    trame[i-1].start_sample_index,
                                                    trame[i].end_sample_index);

                            lrc += byte_value;
                            var pkt_str = "";
                            var exception_code = 0;
                            switch(fct_code)//fill dec_items and packet view
                            {
                                case FCT_READ_COIL_STATUS:
                                {
                                    if(request && !response)
                                    {
                                        switch((i/2)-1)
                                        {
                                            case 2://Starting Address Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Starting Address Hi : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Hi : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Starting @ Hi";
                                                break;
                                            }
                                            case 3://Starting Address Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Starting Address Lo : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Lo : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Starting @ Lo";
                                                break;
                                            }
                                            case 4://Quantity of Coils Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Coils Hi : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Hi : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Qty Coils Hi";
                                                break;
                                            }
                                            case 5://Quantity of Coils Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Coils Lo : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Lo : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Qty Coils Lo";
                                                break;
                                            }
                                            default://warning
                                            {
                                                ScanaStudio.dec_item_emphasize_warning();
                                                pkt_str = "Data";
                                                break;
                                            }
                                        }
                                    }
                                    else if(!request && response)
                                    {
                                        switch((i/2)-1)
                                        {
                                            case 2://Byte Count
                                            {
                                                ScanaStudio.dec_item_add_content("Byte Count : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Cnt : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Cnt";
                                                break;
                                            }
                                            default://data and warning
                                            {
                                                if(i - 7 < (str_to_hex(trame[5].content)*16 + str_to_hex(trame[6].content))*2 && (i-7>=0) )
                                                {
                                                    ScanaStudio.dec_item_add_content("Data : " + dec_to_str(byte_value, "0x"));
                                                    pkt_str = "Data";
                                                }
                                                else
                                                {
                                                    ScanaStudio.dec_item_emphasize_warning();
                                                    pkt_str = "Data";
                                                }
                                                break;
                                            }
                                        }
                                    }
                                    else
                                    {
                                        //warning
                                        ScanaStudio.dec_item_emphasize_error();
                                        // pkt_str = "Data";
                                    }
                                    break;
                                }//end FCT_READ_COIL_STATUS datas

                                case FCT_READ_INPUT_STATUS:
                                {
                                    if(request && !response)
                                    {
                                        switch((i/2)-1)
                                        {
                                            case 2://Starting Address Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Starting Address Hi : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Hi : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Starting @ Hi";
                                                break;
                                            }
                                            case 3://Starting Address Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Starting Address Lo : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Lo : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Starting @ Lo";
                                                break;
                                            }
                                            case 4://Quantity of Inputs Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Inputs Hi : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Hi : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Qty In Hi";
                                                break;
                                            }
                                            case 5://Quantity of Inputs Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Inputs Lo : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Lo : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Qty In Lo";
                                                break;
                                            }
                                            default://warning
                                            {
                                                ScanaStudio.dec_item_emphasize_warning();
                                                pkt_str = "Data";
                                                break;
                                            }
                                        }
                                    }
                                    else if(!request && response)
                                    {
                                        switch((i/2)-1)
                                        {
                                            case 2://Byte Count
                                            {
                                                ScanaStudio.dec_item_add_content("Byte Count : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Cnt : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Cnt";
                                                break;
                                            }
                                            default://data and warning
                                            {
                                                if(i - 7 < (str_to_hex(trame[5].content)*16 + str_to_hex(trame[6].content))*2 && (i-7>=0) )
                                                {
                                                    ScanaStudio.dec_item_add_content("Data : " + dec_to_str(byte_value, "0x"));
                                                    pkt_str = "Data";
                                                }
                                                else
                                                {
                                                    ScanaStudio.dec_item_emphasize_warning();
                                                    pkt_str = "Data";
                                                }
                                                break;
                                            }
                                        }
                                    }
                                    else
                                    {
                                        //warning
                                        ScanaStudio.dec_item_emphasize_error();
                                        // pkt_str = "Data";
                                    }
                                    break;
                                }//end FCT_READ_INPUT_STATUS datas

                                case FCT_READ_HOLDING_REGISTERS:
                                case FCT_READ_INPUT_REGISTERS:
                                {
                                    if(request && !response)
                                    {
                                        switch((i/2)-1)
                                        {
                                            case 2://Starting Address Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Starting Address Hi : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Hi : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Starting @ Hi";
                                                break;
                                            }
                                            case 3://Starting Address Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Starting Address Lo : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Lo : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Starting @ Lo";
                                                break;
                                            }
                                            case 4://Quantity of Register Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Register Hi : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Hi : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Qty Register @ Hi";
                                                break;
                                            }
                                            case 5://Quantity of Register Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Register Lo : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Lo : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Qty Reg @ Lo";
                                                break;
                                            }
                                            default://warning
                                            {
                                                ScanaStudio.dec_item_emphasize_warning();
                                                pkt_str = "Data";
                                                break;
                                            }
                                        }
                                    }
                                    else if(!request && response)
                                    {
                                        switch((i/2)-1)
                                        {
                                            case 2://Byte Count
                                            {
                                                ScanaStudio.dec_item_add_content("Byte Count : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Cnt : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Cnt";
                                                break;
                                            }
                                            default://data and warning     if i%2 == 1 => Data Hi     else Data Lo
                                            {
                                                if(i - 7 < (str_to_hex(trame[5].content)*16 + str_to_hex(trame[6].content))*2 && (i-7>=0) )
                                                {
                                                    if((i/2)%2 == 0)
                                                    {
                                                        ScanaStudio.dec_item_add_content("Data Hi : " + dec_to_str(byte_value, "0x"));
                                                        pkt_str = "Data Hi";
                                                    }
                                                    else
                                                    {
                                                        ScanaStudio.dec_item_add_content("Data Lo : " + dec_to_str(byte_value, "0x"));
                                                        pkt_str = "Data Lo";
                                                    }
                                                }
                                                else
                                                {
                                                    ScanaStudio.dec_item_emphasize_warning();
                                                    pkt_str = "Data";
                                                }
                                                break;
                                            }
                                        }
                                    }
                                    else
                                    {
                                        //warning
                                        ScanaStudio.dec_item_emphasize_error();
                                        // pkt_str = "Data";
                                    }
                                    break;
                                }//end FCT_READ_HOLDING_REGISTERS and FCT_READ_INPUT_REGISTERS datas

                                case FCT_WRITE_SINGLE_COIL:
                                {
                                    if(trame.length == 17)
                                    {
                                        switch((i/2)-1)
                                        {
                                            case 2://Coil Address Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Coil Address Hi : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Hi : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Coil @ Hi";
                                                break;
                                            }
                                            case 3://Coil Address Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Coil Address Lo : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Lo : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Coil @ Lo";
                                                break;
                                            }
                                            case 4://Write Data Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Write Data Hi : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Hi : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Wr Data Hi";
                                                break;
                                            }
                                            case 5://Write Data Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Write Data Lo : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Lo : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Wr Data Lo";
                                                break;
                                            }
                                            default://warning
                                            {
                                                ScanaStudio.dec_item_emphasize_warning();
                                                pkt_str = "Data";
                                                break;
                                            }
                                        }
                                    }
                                    else
                                    {
                                        //warning
                                        ScanaStudio.dec_item_emphasize_error();
                                        // pkt_str = "Data";
                                    }
                                    break;
                                }//end FCT_WRITE_SINGLE_COIL datas

                                case FCT_WRITE_SINGLE_REGISTER:
                                {
                                    if(trame.length == 17)
                                    {
                                        switch((i/2)-1)
                                        {
                                            case 2://Register Address Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Register Address Hi : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Hi : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Reg @ Hi";
                                                break;
                                            }
                                            case 3://Register Address Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Register Address Lo : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Lo : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Reg @ Lo";
                                                break;
                                            }
                                            case 4://Write Data Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Write Data Hi : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Hi : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Wr Data Hi";
                                                break;
                                            }
                                            case 5://Write Data Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Write Data Lo : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Lo : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Wr Data Lo";
                                                break;
                                            }
                                            default://warning
                                            {
                                                ScanaStudio.dec_item_emphasize_warning();
                                                pkt_str = "Data";
                                                break;
                                            }
                                        }
                                    }
                                    else
                                    {
                                        //warning
                                        ScanaStudio.dec_item_emphasize_error();
                                        // pkt_str = "Data";
                                    }
                                    break;
                                }//end FCT_WRITE_SINGLE_COIL datas

                                case FCT_WRITE_MULTIPLE_COILS:
                                {
                                    if(request && !response)
                                    {
                                        switch((i/2)-1)
                                        {
                                            case 2://Coil Address Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Coil Address Hi : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Hi : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Coil @ Hi";
                                                break;
                                            }
                                            case 3://Coil Address Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Coil Address Lo : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Lo : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Coil @ Lo";
                                                break;
                                            }
                                            case 4://Quantity of Coil Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Coil Hi : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Hi : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Qty Hi";
                                                break;
                                            }
                                            case 5://Quantity of Coil Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Coil Lo : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Lo : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Qty Lo";
                                                break;
                                            }
                                            case 6://byte Count
                                            {
                                                ScanaStudio.dec_item_add_content("Byte Count : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Cnt : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Cnt";
                                                break;
                                            }
                                            default://warning and data    if i%2 == 1 => Data Hi    else Data Lo
                                            {
                                                if(i - 15 < (str_to_hex(trame[13].content)*16 + str_to_hex(trame[14].content))*2 && (i-15>=0) )
                                                {
                                                    if((i/2)%2 == 0)
                                                    {
                                                        ScanaStudio.dec_item_add_content("Data Hi : " + dec_to_str(byte_value, "0x"));
                                                        pkt_str = "Data Hi";
                                                    }
                                                    else
                                                    {
                                                        ScanaStudio.dec_item_add_content("Data Lo : " + dec_to_str(byte_value, "0x"));
                                                        pkt_str = "Data Lo";
                                                    }
                                                }
                                                else
                                                {
                                                    ScanaStudio.dec_item_emphasize_warning();
                                                    pkt_str = "Data";
                                                }
                                                break;
                                            }
                                        }
                                    }
                                    else if(!request && response)
                                    {
                                        switch((i/2)-1)
                                        {
                                            case 2://Coil Address Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Coil Address Hi : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Hi : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Coil @ Hi";
                                                break;
                                            }
                                            case 3://Coil Address Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Coil Address Lo : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Lo : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Coil @ Lo";
                                                break;
                                            }
                                            case 4://Quantity of Coil Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Coil Hi : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Hi : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Qty Hi";
                                                break;
                                            }
                                            case 5://Quantity of Coil Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Coil Lo : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Lo : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Qty Lo";
                                                break;
                                            }
                                            default://warning
                                            {
                                                ScanaStudio.dec_item_emphasize_warning();
                                                pkt_str = "Data";
                                            }
                                        }
                                    }
                                    else
                                    {
                                        //warning
                                        ScanaStudio.dec_item_emphasize_error();
                                        // pkt_str = "Data";
                                    }
                                    break;
                                }//end FCT_WRITE_MULTIPLE_COILS datas

                                case FCT_WRITE_MULTIPLE_REGISTERS:
                                {
                                    if(request && !response)
                                    {
                                        switch((i/2)-1)
                                        {
                                            case 2://Starting Address Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Starting Address Hi : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Hi : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Starting @ Hi";
                                                break;
                                            }
                                            case 3://Starting Address Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Starting Address Lo : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Lo : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Starting @ Lo";
                                                break;
                                            }
                                            case 4://Quantity of Registers Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Registers Hi : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Hi : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Qty Reg Hi";
                                                break;
                                            }
                                            case 5://Quantity of Registers Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Registers Lo : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Lo : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Qty Reg Lo";
                                                break;
                                            }
                                            case 6://Byte Count
                                            {
                                                ScanaStudio.dec_item_add_content("Byte Count : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Cnt : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Cnt";
                                                break;
                                            }
                                            default://warning and data    if i%2 == 1 => Data Hi    else Data Lo
                                            {
                                                if(i - 15 < (str_to_hex(trame[13].content)*16 + str_to_hex(trame[14].content))*2 && (i-15>=0) )
                                                {
                                                    if((i/2)%2 == 0)
                                                    {
                                                        ScanaStudio.dec_item_add_content("Data Hi : " + dec_to_str(byte_value, "0x"));
                                                        pkt_str = "Data Hi";
                                                    }
                                                    else
                                                    {
                                                        ScanaStudio.dec_item_add_content("Data Lo : " + dec_to_str(byte_value, "0x"));
                                                        pkt_str = "Data Lo";
                                                    }
                                                }
                                                else
                                                {
                                                    ScanaStudio.dec_item_emphasize_warning();
                                                    pkt_str = "Data";
                                                }
                                                break;
                                            }
                                        }
                                    }
                                    else if(!request && response)
                                    {
                                        switch((i/2)-1)
                                        {
                                            case 2://Starting Address Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Starting Address Hi : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Hi : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Starting @ Hi";
                                                break;
                                            }
                                            case 3://Starting Address Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Starting Address Lo : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Lo : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Starting @ Lo";
                                                break;
                                            }
                                            case 4://Quantity of Registers Hi
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Registers Hi : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Hi : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Qty Reg Hi";
                                                break;
                                            }
                                            case 5://Quantity of Registers Lo
                                            {
                                                ScanaStudio.dec_item_add_content("Quantity of Registers Lo : " + dec_to_str(byte_value, "0x"));
                                                ScanaStudio.dec_item_add_content("Lo : " + dec_to_str(byte_value, "0x"));
                                                pkt_str = "Qty Reg Lo";
                                                break;
                                            }
                                            default://warning
                                            {
                                                ScanaStudio.dec_item_emphasize_warning();
                                                pkt_str = "Data";
                                            }
                                        }
                                    }
                                    else
                                    {
                                        //warning
                                        ScanaStudio.dec_item_emphasize_error();
                                        // pkt_str = "Data";
                                    }
                                    break;
                                }//end FCT_WRITE_MULTIPLE_REGISTERS datas

                                default:
                                {
                                    if((trame.length == 11)&&(fct_code&0x80))//exception
                                    {
                                        exception_code = byte_value;
                                        ScanaStudio.dec_item_add_content("Exception : " + exception_to_str(exception_code&0x7F));
                                        ScanaStudio.dec_item_add_content("Ex : " + exception_to_str(exception_code&0x7F));
                                        ScanaStudio.dec_item_add_content("Ex : " + dec_to_str(byte_value, "0x"));
                                        pkt_str = "Exception";
                                        ScanaStudio.dec_item_emphasize_warning();
                                    }
                                    else
                                    {
                                        ScanaStudio.dec_item_add_content("Unknown data : " + dec_to_str(byte_value, "0x"));
                                        pkt_str = "Unknown";
                                    }
                                }
                            }//end switch fct for datas

                            ScanaStudio.dec_item_add_content( dec_to_str(byte_value, "0x") );
                            ScanaStudio.packet_view_add_packet( false,
                                                                channel,
                                                                trame[i-1].start_sample_index,
                                                                trame[i].end_sample_index,
                                                                pkt_str,
                                                                (exception_code != 0) ? exception_to_str(exception_code&0x7F) : dec_to_str(byte_value, "0x"),
                                                                (exception_code != 0) ? ScanaStudio.PacketColors.Error.Title : ScanaStudio.PacketColors.Data.Title,
                                                                (exception_code != 0) ? ScanaStudio.PacketColors.Error.Content : ScanaStudio.PacketColors.Data.Content);
                            if(i == trame.length - 5)
                            {
                                state_machine = ENUM_STATE_LRC;
                            }
                            break;
                        }//end ENUM_STATE_AFTER_FUNCTION

                        case ENUM_STATE_LRC:
                        {
        					lrc= (-lrc)%256;
        					lrc = 256+lrc;
                            lrc &= 0xFF;

                            ScanaStudio.dec_item_new(   channel,
                                                        trame[i-1].start_sample_index,
                                                        trame[i].end_sample_index);
                            if(lrc == byte_value)
                            {
                                ScanaStudio.dec_item_add_content( "LRC OK : " + dec_to_str(byte_value, "0x") );
                                ScanaStudio.dec_item_add_content( "LRC " + dec_to_str(byte_value, "0x") );
                                ScanaStudio.dec_item_add_content( dec_to_str(byte_value, "0x") );

                                ScanaStudio.packet_view_add_packet( false,
                                                                    channel,
                                                                    trame[i-1].start_sample_index,
                                                                    trame[i].end_sample_index,
                                                                    "LRC",
                                                                    dec_to_str(byte_value, "0x") + " OK",
                                                                    ScanaStudio.PacketColors.Check.Title,
                                                                    ScanaStudio.PacketColors.Check.Content);
                            }
                            else //wrong LRC
                            {
                                ScanaStudio.dec_item_add_content( "LRC WRONG : " + dec_to_str(byte_value, "0x") + " should be " + dec_to_str(lrc, "0x") );
                                ScanaStudio.dec_item_add_content( "LRC WRONG :" + dec_to_str(byte_value, "0x") );
                                ScanaStudio.dec_item_add_content( dec_to_str(byte_value, "0x") );
                                ScanaStudio.dec_item_emphasize_error();

                                ScanaStudio.packet_view_add_packet( false,
                                                                    channel,
                                                                    trame[i-1].start_sample_index,
                                                                    trame[i].end_sample_index,
                                                                    "LRC",
                                                                    dec_to_str(byte_value, "0x") + " Wrong, should be " +  dec_to_str(lrc, "0x"),
                                                                    ScanaStudio.PacketColors.Error.Title,
                                                                    ScanaStudio.PacketColors.Error.Content);
                            }

                            state_machine = ENUM_STATE_EOF;
                            break;
                        }//end ENUM_STATE_LRC
                    }// end switch state_machine
                }// end for i in trame
            }//end if trame ended
        }//end if trame started
    }//end for j in uart_item
}//end function decode for ASCII mode


function on_decode_signals(resume)
{
    //Write the decoder here
    if (!resume)
    {
        //initialization code
        reload_dec_gui_values();
        state_machine = ENUM_STATE_SOF;
        current_byte_cnt = -1;
        current_fct = -1;
        current_i_fct = -1;
        trame = [];
        trame_started = false;
        trame_ended = false;
        last_item_end = 0;
    }

    if(mode==0)//RTU mode
    {
        available_samples = ScanaStudio.get_available_samples(channel);
        on_decode_signals_RTU_mode(ScanaStudio.pre_decode("uart.js",resume));
    }
    else //ASCII mode
    {
        available_samples = ScanaStudio.get_available_samples(channel);
        on_decode_signals_ASCII_mode(ScanaStudio.pre_decode("uart.js",resume));
    }

}//end function decode signals


function on_build_demo_signals()
{
    var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
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
        var rng_ex_report = Math.floor(Math.random()*10);

        if(rng_fct>=7)
            rng_fct+=8;

        if(rng_mode == 0) //RTU
        {
            my_builder.put_silence(Math.floor(Math.random()*6.5) + 3.5);


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

            my_builder.modbus_RTU_write_data(RTU_data);
        }
        else //ASCII
        {
            my_builder.put_silence(Math.floor(Math.random()*5) + 0);
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

            my_builder.modbus_ASCII_write_data(ASCII_data);
        }
    }//end while
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
        lrc &= 0xFF;

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
    if(b_request==-2)
    {
        str = "Unknown ";
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
        default :
        {
            str += "Function";
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

function str_to_hex(str)
{
    var tmp_val = 0;
    if( (str >= 0x30) && (str <= 0x39) ) //0-9
    {
        tmp_val = str - 0x30;
    }
    else if( (str >= 0x41) && (str <= 0x46) ) //A-F
    {
        tmp_val = str - 0x41 + 10;
    }
    else if( (str >= 0x61) && (str <= 0x66) ) //A-F
    {
        tmp_val = str - 0x61 + 10;
    }
    return tmp_val;
}
