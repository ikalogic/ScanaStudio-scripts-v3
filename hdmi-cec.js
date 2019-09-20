/* Protocol meta info:
<NAME> HDMI-CEC </NAME>
<DESCRIPTION>
Consumer Electronics Control (CEC) is an HDMI feature designed to allow the user to command and control up to 15 CEC-enabled devices, that are connected through HDMI.
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


//Decoder GUI
function on_draw_gui_decoder()
{
    ScanaStudio.gui_add_ch_selector("ch", "Channel to decode", "HDMI-CEC" );

    ScanaStudio.gui_add_new_tab("Output format",true);
    ScanaStudio.gui_add_check_box("format_hex","HEX",true);
    ScanaStudio.gui_add_check_box("format_ascii","ASCII",false);
    ScanaStudio.gui_add_check_box("format_dec","Unsigned decimal",false);
    ScanaStudio.gui_add_check_box("format_bin","Binary",false);
    ScanaStudio.gui_end_tab();
}

//Evaluate decoder GUI
function on_eval_gui_decoder()
{
    return ""; //All good.
}

//https://github.com/floe/CEC/blob/master/extras/CEC_Specs.pdf
const   t_a_min     = 3.5e-3,
        t_a_type    = 3.7e-3,
        t_a_max     = 3.9e-3,
        t_b_min     = 4.3e-3,
        t_b_type    = 4.5e-3,
        t_b_max     = 4.7e-3,
        t1          = 0.4e-3,
        t1_2        = 0.6e-3,
        t2          = 0.8e-3,
        t3          = 0.85e-3,
        t3_4        = 1.05e-3,
        t4          = 1.25e-3,
        t5          = 1.3e-3,
        t5_6        = 1.5e-3,
        t6          = 1.7e-3,
        t7          = 2.05e-3,
        t7_8        = 2.4e-3,
        t8          = 2.75e-3;

const   LOGICAL_ADDR_TV         = 0,
        LOGICAL_ADDR_REC_DEV_1  = 1,
        LOGICAL_ADDR_REC_DEV_2  = 2,
        LOGICAL_ADDR_TUNER_1    = 3,
        LOGICAL_ADDR_PB_DEV_1   = 4,
        LOGICAL_ADDR_AUDIO_SYS  = 5,
        LOGICAL_ADDR_TUNER_2    = 6,
        LOGICAL_ADDR_TUNER_3    = 7,
        LOGICAL_ADDR_PB_DEV_2   = 8,
        LOGICAL_ADDR_REC_DEV_3  = 9,
        LOGICAL_ADDR_TUNER_4    = 10,
        LOGICAL_ADDR_PB_DEV_3   = 11,
        //RESERVED 12
        //RESERVED 13
        LOGICAL_ADDR_FREE_USE   = 14,
        LOGICAL_ADDR_BROADCAST  = 15;

const   ENUM_STATE_START_F      = 0,
        ENUM_STATE_START_R      = 1,
        ENUM_STATE_END_OF_START = 2,
        ENUM_STATE_BIT_F        = 3,
        ENUM_STATE_BIT_R        = 4,
        ENUM_STATE_END_OF_BIT   = 5;


//Global variables
var sampling_rate;
var state_machine;
var last_falling_edge, last_rising_edge;
var bit_cnt;
var bits_sample_pt = [];
var byte;
var byte_sample_start;
var byte_cnt;
var reset;
var format_hex, format_dec, format_ascii, format_bin;

function reload_dec_gui_values()
{
    ch =  Number(ScanaStudio.gui_get_value("ch"));
    format_hex = Number(ScanaStudio.gui_get_value("format_hex"));
    format_dec = Number(ScanaStudio.gui_get_value("format_dec"));
    format_ascii = Number(ScanaStudio.gui_get_value("format_ascii"));
    format_bin = Number(ScanaStudio.gui_get_value("format_bin"));
}

function t2smpl(time)
{
    return sampling_rate * time;
}

function pad(num_str, size) {
    while (num_str.length < size) num_str = "0" + num_str;
    return num_str;
}

function add_header_txt(byte)
{
    var txt = "";
    switch(byte)
    {
        case LOGICAL_ADDR_TV:
        {
            txt = "TV";
            break;
        }
        case LOGICAL_ADDR_REC_DEV_1:
        {
            txt = "Recording Device 1";
            break;
        }
        case LOGICAL_ADDR_REC_DEV_2:
        {
            txt = "Recording Device 2";
            break;
        }
        case LOGICAL_ADDR_TUNER_1:
        {
            txt = "Tunner 1";
            break;
        }
        case LOGICAL_ADDR_PB_DEV_1:
        {
            txt = "Playback Device 1";
            break;
        }
        case LOGICAL_ADDR_AUDIO_SYS:
        {
            txt = "Audio System";
            break;
        }
        case LOGICAL_ADDR_TUNER_2:
        {
            txt = "Tunner 2";
            break;
        }
        case LOGICAL_ADDR_TUNER_3:
        {
            txt = "Tunner 3";
            break;
        }
        case LOGICAL_ADDR_PB_DEV_2:
        {
            txt = "Playback Device 2";
            break;
        }
        case LOGICAL_ADDR_REC_DEV_3:
        {
            txt = "Recording Device 3";
            break;
        }
        case LOGICAL_ADDR_TUNER_4:
        {
            txt = "Tunner 4";
            break;
        }
        case LOGICAL_ADDR_PB_DEV_3:
        {
            txt = "Playback Device 3";
            break;
        }
        case LOGICAL_ADDR_FREE_USE:
        {
            txt = "Free Use address";
            break;
        }
        case LOGICAL_ADDR_BROADCAST:
        {
            txt = "Broadcast";
            break;
        }
    }

    ScanaStudio.dec_item_add_content(txt);

    var content = "";
    if (format_hex)
    {
        content += "0x" + pad(byte.toString(16),Math.ceil(2));
    }
    if (format_ascii)
    {
        content += " '" + String.fromCharCode(byte) + "'";
    }
    if (format_dec)
    {
        content += " (" + byte.toString(10) + ")";
    }
    if (format_bin)
    {
        content += " 0b" + pad(byte.toString(2),nbits) ;
    }
    ScanaStudio.dec_item_add_content(content);
    return txt;
}

function add_block_data_txt(byte)
{
    var content = "";
    if (format_hex)
    {
        content += "0x" + pad(byte.toString(16),Math.ceil(2));
    }
    if (format_ascii)
    {
        content += " '" + String.fromCharCode(byte) + "'";
    }
    if (format_dec)
    {
        content += " (" + byte.toString(10) + ")";
    }
    if (format_bin)
    {
        content += " 0b" + pad(byte.toString(2),nbits) ;
    }
    ScanaStudio.dec_item_add_content(content);

    return content;
}

function on_decode_signals(resume)
{
    if (!resume) //If resume == false, it's the first call to this function.
    {
        reload_dec_gui_values();
        sampling_rate = ScanaStudio.get_capture_sample_rate();

        ScanaStudio.trs_reset(ch);    // Reset the trs iterator.
        state_machine = ENUM_STATE_START_F;
        last_falling_edge = -1;
        last_rising_edge = -1;
        bit_cnt = 0;
        bits_sample_pt = [];
        byte = 0;
        byte_sample_start = 0;
        reset = 0;
        byte_cnt = 0;
    }


    while ( (ScanaStudio.abort_is_requested() == false) && (ScanaStudio.trs_is_not_last(ch) == true) )
    {
        trs = ScanaStudio.trs_get_next(ch);

        switch (state_machine)
        {
            case ENUM_STATE_START_F:
            {
                if(trs.value == 0)
                {
                    last_falling_edge = trs.sample_index;
                    state_machine = ENUM_STATE_START_R;
                }
                else
                {
                    state_machine = ENUM_STATE_START_F;
                }
                break;
            }//end case ENUM_STATE_RESET_F


            case ENUM_STATE_START_R:
            {
                if(trs.value == 1)
                {
                    last_rising_edge = trs.sample_index;
                    state_machine = ENUM_STATE_END_OF_START;
                }
                else
                {
                    state_machine = ENUM_STATE_START_F;
                }
                break;
            }//end case ENUM_STATE_START_R


            case ENUM_STATE_END_OF_START:
            {
                if(trs.value == 0)
                {
                    var nbr_sample_low = last_rising_edge-last_falling_edge;
                    var nbr_sample_low_and_high = trs.sample_index - last_falling_edge;
                    if( (nbr_sample_low >= t2smpl(t_a_min)) && (nbr_sample_low <= t2smpl(t_a_max)) && (nbr_sample_low_and_high >= t2smpl(t_b_min)) && (nbr_sample_low_and_high <= t2smpl(t_b_max)) )
                    {
                        ScanaStudio.dec_item_new(ch, last_falling_edge, trs.sample_index-1);
                        ScanaStudio.dec_item_add_content("Start bit");
                        ScanaStudio.dec_item_add_content("Start");
                        ScanaStudio.dec_item_add_content("S");
                        ScanaStudio.dec_item_end();

                        ScanaStudio.packet_view_add_packet(
                            true,
                            ch,
                            last_falling_edge,
                            trs.sample_index,
                            "HDMI-CEC",
                            "CH " + (ch+1),
                            ScanaStudio.get_channel_color(ch),
                            ScanaStudio.get_channel_color(ch)
                        );
                    }
                    else
                    {
                        last_falling_edge = trs.sample_index;
                        state_machine = ENUM_STATE_START_R;
                        break;
                    }

                    last_falling_edge = trs.sample_index;
                    state_machine = ENUM_STATE_BIT_R;
                    bit_cnt = 0;
                    bits_sample_pt = [];
                    byte = 0;
                    byte_sample_start = trs.sample_index;
                    reset = 0;
                    byte_cnt = 0;
                }
                else
                {
                    state_machine = ENUM_STATE_START_F;
                }
                break;
            }//end case ENUM_STATE_END_OF_START


            case ENUM_STATE_BIT_R:
            {
                if(trs.value == 1)
                {
                    last_rising_edge = trs.sample_index;
                    state_machine = ENUM_STATE_END_OF_BIT;
                }
                else
                {
                    state_machine = ENUM_STATE_START_F;
                }
                break;
            }//end case ENUM_STATE_BIT_R


            case ENUM_STATE_END_OF_BIT:
            {
                if(trs.value == 0)
                {
                    var nbr_sample_low = last_rising_edge - last_falling_edge;
                    var nbr_sample_low_and_high = trs.sample_index - last_falling_edge;
                    var bit_val = 0;

                    if( (nbr_sample_low >= t2smpl(t5)) && (nbr_sample_low <= t2smpl(t6)) && (nbr_sample_low_and_high >= t2smpl(t7)))
                    {
                        //bit 0
                        bit_val = 0;
                    }
                    else if( (nbr_sample_low >= t2smpl(t1)) && (nbr_sample_low <= t2smpl(t2)) && (nbr_sample_low_and_high >= t2smpl(t7)) /*&& (nbr_sample_low_and_high <= t2smpl(t8))*/ )
                    {
                        //bit 1
                        bit_val = 1;
                    }
                    else
                    {
                        ScanaStudio.dec_item_new(ch, last_falling_edge, trs.sample_index);
                        ScanaStudio.dec_item_emphasize_error();
                        ScanaStudio.dec_item_add_content("ERROR timing constrainte not respected");
                        ScanaStudio.dec_item_add_content("ERROR");
                        ScanaStudio.dec_item_end();

                        ScanaStudio.packet_view_add_packet(
                            true,
                            ch,
                            last_falling_edge,
                            trs.sample_index,
                            "ERROR",
                            "timing constrainte not respected",
                            ScanaStudio.PacketColors.Error.Title,
                            ScanaStudio.PacketColors.Error.Content
                        );

                        last_falling_edge = trs.sample_index;
                        state_machine = ENUM_STATE_START_R;
                        break;
                    }

                    var end_packet = trs.sample_index-1;
                    if(nbr_sample_low_and_high > t2smpl(t8))
                    {
                        end_packet = last_falling_edge + t2smpl(t7);
                    }

                    bit_cnt++;
                    if(bit_cnt <= 8)
                    {
                        byte = (byte<<1)|bit_val;
                        bits_sample_pt.push(last_falling_edge + t2smpl(t3_4));
                    }

                    if(byte_cnt == 0)
                    {
                        if(bit_cnt == 4)
                        {
                            //header initiator
                            var txt = "";
                            ScanaStudio.dec_item_new(ch, byte_sample_start, end_packet);
                            txt = add_header_txt(byte);
                            for(var i=0; i<4; i++)
                            {
                                ScanaStudio.dec_item_add_sample_point(bits_sample_pt[i], (((byte>>(3-i))&0x1)==1)? "1":"0");
                            }
                            ScanaStudio.dec_item_end();

                            ScanaStudio.packet_view_add_packet(
                                false,
                                ch,
                                byte_sample_start,
                                end_packet,
                                "Header",
                                txt,
                                ScanaStudio.PacketColors.Head.Title,
                                ScanaStudio.PacketColors.Head.Content
                            );

                            byte_sample_start = trs.sample_index;
                            bits_sample_pt = [];
                            byte = 0;
                        }
                        else if(bit_cnt == 8)
                        {
                            //header destination
                            var txt = "";
                            ScanaStudio.dec_item_new(ch, byte_sample_start, end_packet);
                            txt = add_header_txt(byte);
                            for(var i=0; i<4; i++)
                            {
                                ScanaStudio.dec_item_add_sample_point(bits_sample_pt[i], (((byte>>(3-i))&0x1)==1)? "1":"0");
                            }
                            ScanaStudio.dec_item_end();

                            ScanaStudio.packet_view_add_packet(
                                false,
                                ch,
                                byte_sample_start,
                                end_packet,
                                "Destination",
                                txt,
                                ScanaStudio.PacketColors.Preamble.Title,
                                ScanaStudio.PacketColors.Preamble.Content
                            );

                            byte_cnt++;
                            bits_sample_pt = [];
                            byte = 0;
                        }
                    }
                    else
                    {
                        if(bit_cnt == 8)
                        {
                            var txt = "";
                            ScanaStudio.dec_item_new(ch, byte_sample_start, end_packet);
                            txt = add_block_data_txt(byte);
                            for(var i=0; i<8; i++)
                            {
                                ScanaStudio.dec_item_add_sample_point(bits_sample_pt[i], ((byte>>(7-i)&0x1)==1)? "1":"0");
                            }
                            ScanaStudio.dec_item_end();

                            ScanaStudio.packet_view_add_packet(
                                false,
                                ch,
                                byte_sample_start,
                                end_packet,
                                "Data",
                                txt,
                                ScanaStudio.PacketColors.Data.Title,
                                ScanaStudio.PacketColors.Data.Content
                            );

                            byte = 0;
                            bits_sample_pt = [];
                            byte_cnt++;
                        }
                        else if(bit_cnt == 9)//EOM
                        {
                            ScanaStudio.dec_item_new(ch, last_falling_edge, end_packet);
                            if(bit_val == 0)//more data blocks follow
                            {
                                ScanaStudio.dec_item_add_content("!End Of Message");
                                ScanaStudio.dec_item_add_content("!EOM");
                                ScanaStudio.dec_item_add_sample_point(last_falling_edge + t2smpl(t3_4), "0");
                            }
                            else//the message is complete
                            {
                                ScanaStudio.dec_item_add_content("End Of Message");
                                ScanaStudio.dec_item_add_content("EOM");
                                ScanaStudio.dec_item_add_sample_point(last_falling_edge + t2smpl(t3_4), "1");
                                reset = 1;
                            }
                            ScanaStudio.dec_item_end();
                        }
                        else if(bit_cnt == 10)//ACK
                        {
                            ScanaStudio.dec_item_new(ch, last_falling_edge, end_packet);
                            if(bit_val == 0)//ack received
                            {
                                ScanaStudio.dec_item_add_content("Acknowledge");
                                ScanaStudio.dec_item_add_content("ACK");
                                ScanaStudio.dec_item_add_sample_point(last_falling_edge + t2smpl(t3_4), "0");
                            }
                            else//no ack
                            {
                                ScanaStudio.dec_item_emphasize_warning();
                                ScanaStudio.dec_item_add_content("No Acknowledge");
                                ScanaStudio.dec_item_add_content("NACK");
                                ScanaStudio.dec_item_add_sample_point(last_falling_edge + t2smpl(t3_4), "1");


                                ScanaStudio.packet_view_add_packet(
                                    false,
                                    ch,
                                    last_falling_edge,
                                    end_packet,
                                    "NACK",
                                    "No Acknowledge",
                                    ScanaStudio.PacketColors.Misc.Title,
                                    ScanaStudio.PacketColors.Misc.Content
                                );
                            }
                            ScanaStudio.dec_item_end();

                            bit_cnt = 0;
                            byte_sample_start = trs.sample_index;

                            if(reset == 1)
                            {
                                last_falling_edge = trs.sample_index;
                                state_machine = ENUM_STATE_START_R;
                                break;
                            }
                        }
                    }

                    last_falling_edge = trs.sample_index;
                    if( nbr_sample_low_and_high <= t2smpl(t8) )
                    {
                        state_machine = ENUM_STATE_BIT_R;
                    }
                    else
                    {
                        state_machine = ENUM_STATE_START_R;
                        break;
                    }
                }
                else
                {
                    state_machine = ENUM_STATE_START_F;
                }
                break;
            }//end case ENUM_STATE_END_OF_BIT
        }

    }// end while
}

//Function called to generate demo siganls (when no physical device is attached)
function on_build_demo_signals()
{
    //Use the function below to get the number of samples to be built
    var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
    var builder = ScanaStudio.BuilderObject;
    reload_dec_gui_values();

    builder.config(ch, ScanaStudio.builder_get_sample_rate());


    builder.put_silence(10e-3);

    while (ScanaStudio.builder_get_samples_acc(ch) < samples_to_build)
    {
        builder.put_start_bit_rng();

        var rng_initiator = Math.round(Math.random() * 16);
        var rng_destination = Math.round(Math.random() * 16);

        builder.put_header_block_rng(rng_initiator,rng_destination, 0);

        var random_size = Math.floor(Math.random() * 14) + 1;

        for (var w = 0; w < random_size; w++)
        {
            random_data = Math.round(Math.random() * 256);
            builder.put_data_block_rng(random_data, (w < random_size-1)? 0 : 1);
        }
        builder.put_silence(50e-3);

    }
}


//Builder object that can be shared to other scripts
ScanaStudio.BuilderObject =
{
    ch: 0,
    sampling_rate: 0,

    config : function(channel, sampl_rate)
    {
        this.ch = channel;
        this.sampling_rate = sampl_rate;
    },

    put_silence : function(time)
    {
        ScanaStudio.builder_add_samples(this.ch, 1, this.sampling_rate * time);
    },

    put_start_bit : function()
    {
        ScanaStudio.builder_add_samples(this.ch, 0, this.sampling_rate * t_a_type);
        ScanaStudio.builder_add_samples(this.ch, 1, this.sampling_rate * (t_b_type - t_a_type));
    },

    put_start_bit_rng : function()
    {
        var t_a = t_a_min + (Math.random() * (t_a_max - t_a_min));
        var t_b = t_b_min + (Math.random() * (t_b_max - t_b_min));
        ScanaStudio.builder_add_samples(this.ch, 0, this.sampling_rate * t_a);
        ScanaStudio.builder_add_samples(this.ch, 1, this.sampling_rate * (t_b - t_a));
    },

    put_bit : function(b)
    {
        if(b==0)
        {
            ScanaStudio.builder_add_samples(this.ch, 0, this.sampling_rate * t5_6);
            ScanaStudio.builder_add_samples(this.ch, 1, this.sampling_rate * (t7_8 - t5_6));
        }
        else
        {
            ScanaStudio.builder_add_samples(this.ch, 0, this.sampling_rate * t1_2);
            ScanaStudio.builder_add_samples(this.ch, 1, this.sampling_rate * (t7_8 - t1_2));
        }
    },

    put_bit_rng : function(b)
    {
        if(b==0)
        {
            var t_low = t5 + (Math.random() * (t6 - t5));
            var t_high = t7 + (Math.random() * (t8 - t7));
            ScanaStudio.builder_add_samples(this.ch, 0, this.sampling_rate * t_low);
            ScanaStudio.builder_add_samples(this.ch, 1, this.sampling_rate * (t_high - t_low));
        }
        else
        {
            var t_low = t1 + (Math.random() * (t2 - t1));
            var t_high = t7 + (Math.random() * (t8 - t7));
            ScanaStudio.builder_add_samples(this.ch, 0, this.sampling_rate * t_low);
            ScanaStudio.builder_add_samples(this.ch, 1, this.sampling_rate * (t_high - t_low));
        }
    },

    put_byte : function(byte)
    {
        for(var i=0; i<8; i++)
        {
            this.put_bit( (byte>>(7-i))&0x01 );
        }
    },

    put_byte_rng : function(byte)
    {
        for(var i=0; i<8; i++)
        {
            this.put_bit_rng( (byte>>(7-i))&0x01 );
        }
    },

    put_data_block : function(data, end_of_message)
    {
        this.put_byte(data);
        this.put_bit(end_of_message);
        this.put_bit(0);
    },

    put_data_block_rng : function(data, end_of_message)
    {
        this.put_byte_rng(data);
        this.put_bit_rng(end_of_message);
        this.put_bit_rng(0);
    },

    put_header_block : function(initiator, destination, end_of_message)
    {
        this.put_byte((initiator << 8) | destination);
        this.put_bit(end_of_message);
        this.put_bit(0);
    },

    put_header_block_rng : function(initiator, destination, end_of_message)
    {
        this.put_byte_rng((initiator << 4) | destination);
        this.put_bit_rng(end_of_message);
        this.put_bit_rng(0);
    }

};
