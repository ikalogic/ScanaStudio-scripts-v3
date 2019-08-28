/* Protocol meta info:
<NAME> DMX-512 </NAME>
<DESCRIPTION>
</DESCRIPTION>
<VERSION> 0.6 </VERSION>
<AUTHOR_NAME>  Nicolas BASTIT </AUTHOR_NAME>
<AUTHOR_URL> n.bastit@ikalogic.com </AUTHOR_URL>
<COPYRIGHT> Copyright Nicolas BASTIT </COPYRIGHT>
<LICENSE>  This code is distributed under the terms
of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.6: Updated packet view color palette
V0.5: Added hex view
V0.2: Added dec_item_end() for each dec_item_new().
V0.1: Initial release.
</RELEASE_NOTES>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
*/

function on_draw_gui_decoder()
{
    ScanaStudio.gui_add_ch_selector("ch","Channel to decode","DMX-512");

    //for the next release
    // ScanaStudio.gui_add_new_selectable_containers_group("select_decoder_option","Select decoder option");
    //     ScanaStudio.gui_add_new_container("Decode and display all the data", true);
    //         ScanaStudio.gui_add_info_label("text");
    //     ScanaStudio.gui_end_container();
    //     ScanaStudio.gui_add_new_container("Select wich channels to decode", false);
    //         for(var i=0; i<NBR_MAX_CHANNEL; i++)
    //         {
    //             ScanaStudio.gui_add_check_box("chk" + (i+1), "Channel " + (i+1), false);
    //         }
    //     ScanaStudio.gui_end_container();
    // ScanaStudio.gui_end_selectable_containers_group();

    ScanaStudio.gui_add_hidden_field("baud",250000);

    ScanaStudio.gui_add_hidden_field("format_hex","HEX",true);
    ScanaStudio.gui_add_hidden_field("format_ascii","ASCII",false);
    ScanaStudio.gui_add_hidden_field("format_dec","Unsigned decimal",false);
    ScanaStudio.gui_add_hidden_field("format_bin","Binary",false);
    ScanaStudio.gui_add_hidden_field("nbits",3);
    ScanaStudio.gui_add_hidden_field("parity",0);
    ScanaStudio.gui_add_hidden_field("stop", 2);
    ScanaStudio.gui_add_hidden_field("order", 0);
    ScanaStudio.gui_add_hidden_field("invert", 0);
}

function on_eval_gui_decoder()
{
    //for the next release
    // if( Number(ScanaStudio.gui_get_value("select_decoder_option") ) )
    // {
    //     var at_least_one_selected = false;
    //     for(var i=0; i<NBR_MAX_CHANNEL; i++)
    //     {
    //         if( Number(ScanaStudio.gui_get_value("chk" + (i+1))) )
    //         {
    //             at_least_one_selected = true;
    //             break;
    //         }
    //     }
    //
    //     if(!at_least_one_selected)
    //     {
    //         return "Select at least one channel to decode";
    //     }
    // }

    if (Number(ScanaStudio.gui_get_value("baud")*8) >= (ScanaStudio.get_capture_sample_rate()))
    {
        return "Sampling rate is too low compared to DMX-512 baudrate (250kb/s). Sampling rate should be at least 8 times greater than the bauderate.";
    }

    return "";
}

var channel;
var trs;
var last_trs;
var trame = [];
var trame_started;
var trame_ended;
//for the next release
// var select_decoder;
// var list_channel = [];
// var i_ch;

//time constant in s from http://stsserd.free.fr/Cours_sts2/Logique/Pr%E9sentation%20DMX512.pdf
const   CONST_t_break_min       = 88e-6,
        CONST_t_break_type      = 88e-6,
        CONST_t_break_max       = 1,
        CONST_t_btw_break       = 1.2e-3,
        CONST_t_MAB_min         = 8e-6, //MAB = Mark After Break
        CONST_t_MAB_type        = 8e-6,
        CONST_t_MAB_max         = 1,
        CONST_time_tolerance    = 0.02, //2%
        CONST_t_bit             = 4e-6,
        CONST_t_MTBF_min        = 0, //MTBF : Mark Time Between Frame
        CONST_t_MTBF_max        = 1,
        CONST_t_MTBP_min        = 0, //MTBP : Mark Time Between Packet
        CONST_t_MTBP_max        = 1;

const   ENUM_STATE_BREAK    = 0,
        ENUM_STATE_MAB      = 1,
        ENUM_STATE_START    = 2,
        ENUM_STATE_MTBF     = 3,
        ENUM_STATE_DATA     = 4;

//for the next release
// const NBR_MAX_CHANNEL = 30;//512;

function reload_dec_gui_values()
{
    channel = Number(ScanaStudio.gui_get_value("ch"));

    //for the next release
    // select_decoder = Number(ScanaStudio.gui_get_value("select_decoder_option") );
    // list_channel = [];
    // if(select_decoder == 1)
    // {
    //     for(var i=0; i<NBR_MAX_CHANNEL; i++)
    //     {
    //         if( Number(ScanaStudio.gui_get_value("chk" + (i+1))) )
    //         {
    //             list_channel.push(i+1);
    //         }
    //     }
    // }
}

function on_decode_signals (resume)
{
    if (!resume)
    {
        //initialization code
        reload_dec_gui_values();
        trame = [];
        trame_started = false;
        trame_ended = false;
        ScanaStudio.trs_reset(channel);
        trs = ScanaStudio.trs_get_next(channel);
        last_trs = trs;
    }

    var uart_items = ScanaStudio.pre_decode("uart.js",resume);
    var sample_rate = ScanaStudio.get_capture_sample_rate();

    for (var j = uart_items.length - 1; j >= 0; j--)
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

    for (var j=0; (j<uart_items.length) && (!ScanaStudio.abort_is_requested()); j++)
    {
        var ignore_item = false;

        while ((last_trs.sample_index < uart_items[j].start_sample_index) && (ScanaStudio.trs_is_not_last(channel)) && (!ScanaStudio.abort_is_requested()))
        {
            if ((trs.value == 1)  // start condition is BREAK + MAB
                && (trs.sample_index - last_trs.sample_index >= sample_rate*CONST_t_break_min)
                && (trs.sample_index - last_trs.sample_index <= sample_rate*CONST_t_break_max))
            {
                if(trame_started)//searching for end condition
                {
                    trame_ended = true;
                    ignore_item = true;
                    j--;
                    break;
                }
                else
                {
                    if(ScanaStudio.trs_is_not_last(channel))
                    {
                        last_trs = trs;
                        trs = ScanaStudio.trs_get_next(channel);
                    }
                    else
                    {
                        break;
                    }

                    if( (trs.value==0)
                        && (trs.sample_index - last_trs.sample_index >= sample_rate*CONST_t_MAB_min)
                        && (trs.sample_index - last_trs.sample_index <= sample_rate*CONST_t_MAB_max) )
                    {
                        if(!trame_started)//if frame is not started
                        {
                            trame = [];
                            trame_started = true;
                            ignore_item = true;
                            break;
                        }
                    }
                    else
                    {
                        //WRONG MAB
                    }
                }
            }
            else
            {
                last_trs = trs;
                trs = ScanaStudio.trs_get_next(channel);
            }
        }//end while searching for start condition

        if(j==uart_items.length-1)
        {
            if(!ScanaStudio.trs_is_not_last(channel))
            {
                if(trame_started && (trame.length != 0))//searching for end condition
                {
                    if( (trs.value==0) && (trs.sample_index - last_trs.sample_index >= sample_rate*CONST_t_break_type) )
                    {
                        trame_ended = true;
                        ignore_item = true;
                    }
                }
            }
        }

        if(trame_started)//if frame has already started
        {
            if(!ignore_item)
            {
                trame.push(uart_items[j]);
            }

            if(trame_ended)//decode trame
            {
                trame_ended = false;
                trame_started = false;

                ScanaStudio.packet_view_add_packet( true,
                                                    channel,
                                                    trame[0].start_sample_index,
                                                    trame[trame.length-1].end_sample_index,
                                                    "DMX-512",
                                                    "CH" + (channel + 1),
                                                    ScanaStudio.get_channel_color(channel),
                                                    ScanaStudio.get_channel_color(channel));

                for (var i=0; (i<trame.length) && (!ScanaStudio.abort_is_requested()); i++)
                {
                    if (i==0)
                    {
                        if ((trame[i].content == "0x00"))
                        {
                            ScanaStudio.dec_item_new(channel, trame[i].start_sample_index, trame[i].end_sample_index);
                            ScanaStudio.dec_item_add_content("Start");
                            ScanaStudio.dec_item_end();

                            //for the next release
                            // i_ch = 0;

                            ScanaStudio.packet_view_add_packet(
                                false,
                                channel,
                                trame[i].start_sample_index,
                                trame[i].end_sample_index,
                                "Start",
                                "Ok",
                                ScanaStudio.PacketColors.Wrap.Title,
                                ScanaStudio.PacketColors.Wrap.Content);
                        }
                        else
                        {
                            ScanaStudio.dec_item_new(channel, trame[i].start_sample_index, trame[i].end_sample_index);
                            ScanaStudio.dec_item_add_content( "WRONG Start " + trame[i].content);
                            ScanaStudio.dec_item_add_content( trame[i].content);
                            ScanaStudio.dec_item_emphasize_error();
                            ScanaStudio.dec_item_end();

                            ScanaStudio.packet_view_add_packet(
                                false,
                                channel,
                                trame[i].start_sample_index,
                                trame[i].end_sample_index,
                                "Start",
                                "Wrong",
                                ScanaStudio.PacketColors.Error.Title,
                                ScanaStudio.PacketColors.Error.Content);
                        }
                    }
                    else
                    {
                        ScanaStudio.dec_item_new(channel,trame[i].start_sample_index,trame[i].end_sample_index);
                        ScanaStudio.dec_item_add_content(trame[i].content);
                        ScanaStudio.dec_item_end();
                        ScanaStudio.hex_view_add_byte(channel, trame[i].start_sample_index, trame[i].end_sample_index, trame[i].content);
                        ScanaStudio.packet_view_add_packet( false,
                                                            channel,
                                                            trame[i].start_sample_index,
                                                            trame[i].end_sample_index,
                                                            "Chan " + i,
                                                            trame[i].content,
                                                            ScanaStudio.PacketColors.Data.Title,
                                                            ScanaStudio.PacketColors.Data.Content);
                    }
                }//en for each item in trame
            }//end if trame ended
        }//end if trame started
    }//end for each uart item
}

function on_build_demo_signals()
{
    var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
    var dmx512_builder = ScanaStudio.BuilderObject;
    reload_dec_gui_values();
    dmx512_builder.config(channel, ScanaStudio.builder_get_sample_rate());

    var frame = [];

    for(var i = 0; i<512; i++)
    {
        frame.push(0);
    }

    frame[14] = 45;
    frame[15] = 1;
    frame[16] = 2;
    frame[20] = 54;

    while( ScanaStudio.builder_get_samples_acc(channel) < samples_to_build )
    {
        dmx512_builder.put_silence(0.01);
        dmx512_builder.put_frame(frame);
    }
}

//Builder object that can be shared to other scripts
ScanaStudio.BuilderObject = {
    rng : false,

    config : function(ch, sample_rate)
    {
        this.channel = ch;
        this.sample_rate = sample_rate;
    },

    put_silence : function (duration_s)
    {
        var samples_count = duration_s*this.sample_rate;
        if (samples_count == 0)
            samples_count = 1;

        ScanaStudio.builder_add_samples(this.channel, 1, samples_count);
    },

    put_break : function()
    {
        var duration_s;
        if(this.rng)
            duration_s = Math.random()*(CONST_t_break_max - CONST_t_break_min) + CONST_t_break_min;
        else
            duration_s = CONST_t_break_type;
        ScanaStudio.builder_add_samples(this.channel, 0, duration_s * this.sample_rate);
    },

    put_MAB : function()
    {
        var duration_s;
        if(this.rng)
            duration_s = Math.random()*(CONST_t_MAB_max - CONST_t_MAB_min) + CONST_t_MAB_min;
        else
            duration_s = CONST_t_MAB_type;
        ScanaStudio.builder_add_samples(this.channel, 1, duration_s * this.sample_rate);
    },

    put_MTBF : function()
    {
        var duration_s;
        if(this.rng)
            duration_s = Math.random()*(CONST_t_MTBF_max - CONST_t_MTBF_min) + CONST_t_MTBF_min;
        else
            duration_s = CONST_t_MTBF_min;
        ScanaStudio.builder_add_samples(this.channel, 1, duration_s * this.sample_rate);
    },

    put_MTBP : function()
    {
        var duration_s;
        if(this.rng)
            duration_s = Math.random()*(CONST_t_MTBP_max - CONST_t_MTBP_min) + CONST_t_MTBP_min;
        else
            duration_s = CONST_t_MTBP_min;
        ScanaStudio.builder_add_samples(this.channel, 1, duration_s * this.sample_rate);
    },

    put_bit : function(bit_val)
    {
        var duration_s;
        if(this.rng)
            duration_s = ((Math.random()*2 - 1) * CONST_time_tolerance + 1) * CONST_t_bit; // CONST_t_bit +/- CONST_time_tolerance
        else
            duration_s = CONST_t_bit;
        ScanaStudio.builder_add_samples(this.channel, bit_val, duration_s * this.sample_rate);
    },

    put_word : function(byte_val)
    {
        //put start bit
        this.put_bit(0);

        //put data
        for(var i=0; i<8; i++)
        {
            this.put_bit( (byte_val>>i) & 0x01 ); //LSB first
        }

        //put 2 stop bit
        this.put_bit(1);
        this.put_bit(1);

    },

    put_start_frame : function()
    {
        this.put_word(0);
    },

    put_frame : function(frame)
    {
        this.put_break();
        this.put_MAB();

        // this.put_MTBF();
        this.put_start_frame();

        for(var i=0; i<frame.length; i++)
        {
            this.put_MTBF();
            this.put_word(frame[i]);
        }

        this.put_MTBP();
    }
};
