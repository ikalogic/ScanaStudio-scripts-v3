/* Protocol meta info:
<NAME> Atmel SWI </NAME>
<DESCRIPTION>

</DESCRIPTION>
<VERSION> 0.1 </VERSION>
<AUTHOR_NAME> Nicolas BASTIT </AUTHOR_NAME>
<AUTHOR_URL> n.bastit@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright Nicolas BASTIT </COPYRIGHT>
<LICENSE> This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.1:  Initial release.
</RELEASE_NOTES>
*/


//Type "template..." in Atom.io editor (with ScanaStudio plugin) to generate code examples.
//Decoder GUI
function on_draw_gui_decoder()
{
    ScanaStudio.gui_add_ch_selector("ch","Channel to decode","Atmel SWI");

    ScanaStudio.gui_add_baud_selector("baud","BAUD rate",9600);

    ScanaStudio.gui_add_hidden_field("parity",0); //no parity
    ScanaStudio.gui_add_hidden_field("stop",0); //1 stop bit
    ScanaStudio.gui_add_hidden_field("nbits",2); //7 bits
    ScanaStudio.gui_add_hidden_field("invert", 0); // non inverted logic
    ScanaStudio.gui_add_hidden_field("order", 0); // LSB
    ScanaStudio.gui_add_hidden_field("format_hex","false");
    ScanaStudio.gui_add_hidden_field("format_ascii","false");
    ScanaStudio.gui_add_hidden_field("format_dec","false");
    ScanaStudio.gui_add_hidden_field("format_bin","false");
}

//Global variables
var sampling_rate;
var channel;
var baud;
var available_samples;
var uart_items = [];
var state_machine;
var octet_start, octet_last_end;
var octet_samples_bits = [];
var bit_cnt;
var octet_val;
var octet_cnt;
var actual_nbr_octet;
var trame = [];
var crc;


const   ENUM_STATE_WAITING_WAKE             = 0,
        ENUM_STATE_SEARCH_CMD               = 1,
        ENUM_STATE_TRANSMIT_CNT             = 10,
        ENUM_STATE_TRANSMIT_DATA            = 11,
        ENUM_STATE_TRANSMIT_CRC_1           = 12,
        ENUM_STATE_TRANSMIT_CRC_2           = 13,
        ENUM_STATE_COMMAND_CNT              = 20,
        ENUM_STATE_COMMAND_DATA             = 21;

const   BYTE_WAKE       = 0x00,
        BYTE_TRANSMIT   = 0x88,
        BYTE_COMMAND    = 0x77,
        BYTE_IDLE       = 0xBB;

function reload_dec_gui_values()
{
    channel = Number(ScanaStudio.gui_get_value("ch"));
    baud = Number(ScanaStudio.gui_get_value("baud"));
}

//Evaluate decoder GUI
function on_eval_gui_decoder()
{
    ScanaStudio.set_script_instance_name("Atmel SWI on CH"+(ScanaStudio.gui_get_value("ch")+1).toString());
    if(Number(ScanaStudio.gui_get_value("baud")*8) >= (ScanaStudio.get_capture_sample_rate()) )
    {
        return "Selected bauderate is too high compared to the sampling rate you chose. Bauderate should be at least 8 times lower than the sampling rate.";
    }

    if(Number(ScanaStudio.gui_get_value("baud")) == 0)
    {
        return "Selected bauderate can't be null.";
    }

    return ""; //All good.
}


function on_decode_signals(resume)
{
    if (!resume) //If resume == false, it's the first call to this function.
    {
        //initialization code
        reload_dec_gui_values();
        uart_items = [];
        octet_start = 0;
        octet_last_end = 0;
        bit_cnt = 0;
        octet_val = 0;
        octet_cnt = 0;
        octet_samples_bits = [];
        trame = [];
        crc = 0;
        state_machine = ENUM_STATE_WAITING_WAKE;
    }

    available_samples = ScanaStudio.get_available_samples(channel);
    uart_items = ScanaStudio.pre_decode("uart.js",resume);


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

    for (j = 0; j<uart_items.length; j++)
    {
        if(bit_cnt == 0)
        {
            octet_start = uart_items[j].start_sample_index;
            octet_val = 0;
            octet_samples_bits = [];
        }

        if(uart_items[j].content == "0x7d")
        {
            // octet_val = octet_val<<1;
            bit_cnt++;
            octet_samples_bits.push( (uart_items[j].start_sample_index + uart_items[j].end_sample_index)/2);
        }
        else if(uart_items[j].content == "0x7f")
        {
            octet_val = (1<<bit_cnt)|octet_val;
            bit_cnt++;
            octet_samples_bits.push( (uart_items[j].start_sample_index + uart_items[j].end_sample_index)/2);
        }
        else
        {
            bit_cnt = 0;
        }

        if(bit_cnt >= 8)
        {
            bit_cnt = 0;
            ScanaStudio.dec_item_new(channel, octet_start, uart_items[j].end_sample_index);
            ScanaStudio.dec_item_add_content( "0x" + octet_val.toString(16) );
            for(var i=0; i<8; i++)
            {
                ScanaStudio.dec_item_add_sample_point(octet_samples_bits[i],((octet_val>>i)&0x1)?"1":"0");
            }
            ScanaStudio.dec_item_end();

            ScanaStudio.hex_view_add_byte(channel, octet_start, uart_items[j].end_sample_index, octet_val);
/*
            switch(state_machine)
            {
                case ENUM_STATE_WAITING_WAKE:
                {
                    if(octet_val == BYTE_WAKE)
                    {
                        ScanaStudio.dec_item_new(channel, octet_start, uart_items[j].end_sample_index);
                        ScanaStudio.dec_item_add_content( "WAKE 0x" + octet_val.toString(16) );
                        ScanaStudio.dec_item_add_content( "WAKE" );
                        ScanaStudio.dec_item_add_content( "0x" + octet_val.toString(16));
                        ScanaStudio.dec_item_end();
                        state_machine = ENUM_STATE_SEARCH_CMD;
                        octet_last_end = uart_items[j].end_sample_index;
                    }
                    break;
                }//end case ENUM_STATE_WAITING_WAKE


                case ENUM_STATE_SEARCH_CMD:
                {
                    trame = [];
                    if(octet_val == BYTE_TRANSMIT)
                    {
                        trame.push(octet_val);
                        ScanaStudio.dec_item_new(channel, octet_start, uart_items[j].end_sample_index);
                        ScanaStudio.dec_item_add_content( "TRANSMIT 0x" + octet_val.toString(16) );
                        ScanaStudio.dec_item_add_content( "TRANSMIT" );
                        ScanaStudio.dec_item_add_content( "0x" + octet_val.toString(16));
                        ScanaStudio.dec_item_end();
                        state_machine = ENUM_STATE_TRANSMIT_CNT;
                        octet_last_end = uart_items[j].end_sample_index;
                    }
                    else if(octet_val == BYTE_COMMAND)
                    {
                        ScanaStudio.dec_item_new(channel, octet_start, uart_items[j].end_sample_index);
                        ScanaStudio.dec_item_add_content( "COMMAND 0x" + octet_val.toString(16) );
                        ScanaStudio.dec_item_add_content( "COMMAND" );
                        ScanaStudio.dec_item_add_content( "0x" + octet_val.toString(16));
                        ScanaStudio.dec_item_end();
                        state_machine = ENUM_STATE_COMMAND_CNT;
                        octet_last_end = uart_items[j].end_sample_index;
                    }
                    else if(octet_val == BYTE_IDLE)
                    {
                        ScanaStudio.dec_item_new(channel, octet_start, uart_items[j].end_sample_index);
                        ScanaStudio.dec_item_add_content( "IDLE 0x" + octet_val.toString(16) );
                        ScanaStudio.dec_item_add_content( "IDLE" );
                        ScanaStudio.dec_item_add_content( "0x" + octet_val.toString(16));
                        ScanaStudio.dec_item_end();
                        state_machine = ENUM_STATE_WAITING_WAKE;
                        octet_last_end = uart_items[j].end_sample_index;
                    }
                    else if(octet_val == BYTE_WAKE)
                    {
                        ScanaStudio.dec_item_new(channel, octet_last_end, octet_start - 1);
                        ScanaStudio.dec_item_emphasize_error();
                        ScanaStudio.dec_item_add_content( "IDLE missing" );
                        ScanaStudio.dec_item_add_content( "!IDLE" );
                        ScanaStudio.dec_item_end();

                        ScanaStudio.dec_item_new(channel, octet_start, uart_items[j].end_sample_index);
                        ScanaStudio.dec_item_add_content( "WAKE 0x" + octet_val.toString(16) );
                        ScanaStudio.dec_item_add_content( "WAKE" );
                        ScanaStudio.dec_item_add_content( "0x" + octet_val.toString(16));
                        ScanaStudio.dec_item_end();
                        state_machine = ENUM_STATE_SEARCH_CMD;
                        octet_last_end = uart_items[j].end_sample_index;
                    }
                    else
                    {
                        state_machine = ENUM_STATE_WAITING_WAKE;
                        octet_last_end = uart_items[j].end_sample_index;
                    }
                    break;
                }//end case ENUM_STATE_SEARCH_CMD


                case ENUM_STATE_TRANSMIT_CNT:
                {
                    trame.push(octet_val);
                    octet_cnt = octet_val;
                    actual_nbr_octet = 1;
                    ScanaStudio.dec_item_new(channel, octet_start, uart_items[j].end_sample_index);
                    ScanaStudio.dec_item_add_content( "CNT 0x" + octet_val.toString(16) );
                    ScanaStudio.dec_item_add_content( "0x" + octet_val.toString(16));
                    ScanaStudio.dec_item_end();
                    state_machine = ENUM_STATE_TRANSMIT_DATA;
                    octet_last_end = uart_items[j].end_sample_index;
                    break;
                }//end case ENUM_STATE_TRANSMIT_CNT


                case ENUM_STATE_TRANSMIT_DATA:
                {
                    trame.push(octet_val);
                    actual_nbr_octet++;
                    ScanaStudio.dec_item_new(channel, octet_start, uart_items[j].end_sample_index);
                    ScanaStudio.dec_item_add_content( "DATA 0x" + octet_val.toString(16) );
                    ScanaStudio.dec_item_add_content( "0x" + octet_val.toString(16));
                    ScanaStudio.dec_item_end();
                    if(actual_nbr_octet<octet_cnt-2)
                    {
                        state_machine = ENUM_STATE_TRANSMIT_DATA;
                    }
                    else if(actual_nbr_octet==octet_cnt-2)
                    {
                        state_machine = ENUM_STATE_TRANSMIT_CRC_1;
                    }
                    octet_last_end = uart_items[j].end_sample_index;
                    break;
                }//end case ENUM_STATE_TRANSMIT_DATA


                case ENUM_STATE_TRANSMIT_CRC_1:
                {
                    crc = crc_calculation(trame);
                    var tmp_crc = (crc>>8)&0xFF;
                    actual_nbr_octet++;
                    ScanaStudio.dec_item_new(channel, octet_start, uart_items[j].end_sample_index);
                    if( tmp_crc == octet_val)
                    {
                        ScanaStudio.dec_item_add_content( "CRC1 0x" + octet_val.toString(16) );
                        ScanaStudio.dec_item_add_content( "0x" + octet_val.toString(16));
                        ScanaStudio.dec_item_emphasize_success();
                    }
                    else
                    {
                        ScanaStudio.dec_item_add_content( "WRONG CRC1 0x" + octet_val.toString(16) + " should be 0x" + tmp_crc.toString(16) );
                        ScanaStudio.dec_item_add_content( "!CRC1 0x" + octet_val.toString(16) + " should be 0x" + tmp_crc.toString(16) );
                        ScanaStudio.dec_item_add_content( "0x" + octet_val.toString(16));
                        ScanaStudio.dec_item_emphasize_warning();
                    }

                    ScanaStudio.dec_item_end();
                    state_machine = ENUM_STATE_TRANSMIT_CRC_2;
                    octet_last_end = uart_items[j].end_sample_index;
                    break;
                }//end case ENUM_STATE_TRANSMIT_CRC_1


                case ENUM_STATE_TRANSMIT_CRC_2:
                {
                    actual_nbr_octet++;
                    var tmp_crc = crc&0xFF;
                    ScanaStudio.dec_item_new(channel, octet_start, uart_items[j].end_sample_index);
                    if( tmp_crc == octet_val)
                    {
                        ScanaStudio.dec_item_add_content( "CRC2 0x" + octet_val.toString(16) );
                        ScanaStudio.dec_item_add_content( "0x" + octet_val.toString(16));
                        ScanaStudio.dec_item_emphasize_success();
                    }
                    else
                    {
                        ScanaStudio.dec_item_add_content( "WRONG CRC2 0x" + octet_val.toString(16) + " should be 0x" + tmp_crc.toString(16) );
                        ScanaStudio.dec_item_add_content( "!CRC2 0x" + octet_val.toString(16) + " should be 0x" + tmp_crc.toString(16) );
                        ScanaStudio.dec_item_add_content( "0x" + octet_val.toString(16));
                        ScanaStudio.dec_item_emphasize_warning();
                    }
                    ScanaStudio.dec_item_new(channel, octet_start, uart_items[j].end_sample_index);
                    ScanaStudio.dec_item_end();
                    state_machine = ENUM_STATE_SEARCH_CMD;
                    octet_last_end = uart_items[j].end_sample_index;
                    break;
                }//end case ENUM_STATE_TRANSMIT_CRC_1


                case ENUM_STATE_COMMAND_CNT:
                {
                    octet_cnt = octet_val;
                    actual_nbr_octet = 1;
                    ScanaStudio.dec_item_new(channel, octet_start, uart_items[j].end_sample_index);
                    ScanaStudio.dec_item_add_content( "CNT 0x" + octet_val.toString(16) );
                    ScanaStudio.dec_item_add_content( "0x" + octet_val.toString(16));
                    ScanaStudio.dec_item_end();
                    state_machine = ENUM_STATE_COMMAND_DATA;
                    octet_last_end = uart_items[j].end_sample_index;
                    break;
                }//end case ENUM_STATE_COMMAND_CNT


                case ENUM_STATE_COMMAND_DATA:
                {
                    actual_nbr_octet++;
                    ScanaStudio.dec_item_new(channel, octet_start, uart_items[j].end_sample_index);
                    ScanaStudio.dec_item_add_content( "DATA 0x" + octet_val.toString(16) );
                    ScanaStudio.dec_item_add_content( "0x" + octet_val.toString(16));
                    ScanaStudio.dec_item_end();
                    if(actual_nbr_octet<octet_cnt)
                    {
                        state_machine = ENUM_STATE_COMMAND_DATA;
                    }
                    else if(actual_nbr_octet==octet_cnt)
                    {
                        state_machine = ENUM_STATE_SEARCH_CMD;
                    }
                    octet_last_end = uart_items[j].end_sample_index;
                    break;
                }//end case ENUM_STATE_COMMAND_DATA

            }//end switch state_machine
*/
        }//end if bit_cnt >= 8

    }//end for j < uart_items.length
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

//Function called to generate demo siganls (when no physical device is attached)
function on_build_demo_signals()
{
    var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
    var silence_period_samples = (1000 + (samples_to_build / 125))/ScanaStudio.builder_get_sample_rate();
    var uart_builder = ScanaStudio.load_builder_object("uart.js");
    reload_dec_gui_values();
    uart_builder.config(
                        channel,
                        baud,
                        Number(ScanaStudio.gui_get_value("nbits")), //nbits = 7 bits
                        Number(ScanaStudio.gui_get_value("parity")),
                        Number(ScanaStudio.gui_get_value("stop")),
                        Number(ScanaStudio.gui_get_value("order")),
                        Number(ScanaStudio.gui_get_value("invert")),
                        Number(ScanaStudio.builder_get_sample_rate())
    );

    var my_builder = ScanaStudio.BuilderObject;
    my_builder.config( uart_builder, Number(ScanaStudio.builder_get_sample_rate()) );

    my_builder.put_silence(10e-3);

    var counter = 0;
    while(ScanaStudio.builder_get_samples_acc(channel) < samples_to_build)
    {
        if (ScanaStudio.abort_is_requested())
        {
            break;
        }
        var random_size = Math.floor(Math.random()*10) + 1;
        for (w = 0; w < random_size; w++)
        {
            my_builder.put_byte(counter);
            counter++;
            if (ScanaStudio.builder_get_samples_acc(channel) >= samples_to_build)
            {
                break;
            }
        }
        my_builder.put_silence(silence_period_samples);
    }
}


//Builder object that can be shared to other scripts
ScanaStudio.BuilderObject = {
    sampling_rate : 0,

    config : function(uart_builder, sampling_rate)
    {
        this.uart_builder = uart_builder;
        this.sampling_rate = sampling_rate;
    },

    put_silence : function(time)
    {
        ScanaStudio.builder_add_samples(this.uart_builder.channel, 1, time * this.sampling_rate);
    },

    put_bit : function(bit)
    {
        if(bit==0)
        {
            this.uart_builder.put_c(0x7D);
        }
        else if(bit == 1)
        {
            this.uart_builder.put_c(0x7F);
        }
    },

    put_byte : function(byte)
    {
        var i=0;
        for(i=0; i<8; i++)
        {
            this.put_bit( (byte >> i)&0x1 );
        }
    }

};
