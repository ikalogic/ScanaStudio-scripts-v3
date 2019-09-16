/* Protocol meta info:
<NAME> 1-Wire </NAME>
<DESCRIPTION>
1-Wire protocol analyzer. Decodes Reset, presence and byte fields.
</DESCRIPTION>
<VERSION> 0.7 </VERSION>
<AUTHOR_NAME> BASTIT Nicolas </AUTHOR_NAME>
<AUTHOR_URL> n.bastit@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright BASTIT Nicolas </COPYRIGHT>
<LICENSE> This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.7: new skin
V0.6: Added trigger capability
V0.5: Added packet and hex views
V0.2: Added dec_item_end() for each dec_item_new().
V0.1: Fixed sampling point position for presence pulse.
V0.0: Initial release.
</RELEASE_NOTES>
*/

//Decoder GUI
function on_draw_gui_decoder()
{
    //Define decoder configuration GUI
    ScanaStudio.gui_add_ch_selector("ch","Channel to decode","1-Wire");

    ScanaStudio.gui_add_combo_box("speed","1-Wire Speed")
        ScanaStudio.gui_add_item_to_combo_box("Regular speed",true);
        ScanaStudio.gui_add_item_to_combo_box("Overdrive speed",false);

    ScanaStudio.gui_add_combo_box("format","Display format")
        ScanaStudio.gui_add_item_to_combo_box("Decimal",false);
        ScanaStudio.gui_add_item_to_combo_box("HEX",true);
        ScanaStudio.gui_add_item_to_combo_box("Binary",false);
}

//Evaluate decoder GUI
function on_eval_gui_decoder()
{
    ScanaStudio.set_script_instance_name("1-Wire on CH " + (ScanaStudio.gui_get_value("ch") + 1).toString());
    return ""; //All good.
}

//Global variables
var ch;
var speed;
var format;
var suffix;
var sampling_rate;
var state_machine;

const   ENUM_STATE_RESET_F = 0,
        ENUM_STATE_RESET_R = 1,
        ENUM_STATE_PRESENCE_F = 2,
        ENUM_STATE_PRESENCE_R = 3,
        ENUM_STATE_BIT_F = 4,
        ENUM_STATE_BIT_R = 5

//time constante
var t_A_min;
var t_A_type;
var t_A_max;
var t_B_min;
var t_B_type;
var t_C_min;
var t_C_type;
var t_C_max;
var t_D_min;
var t_D_type;
var t_E_min;
var t_E_type;
var t_E_max;
var t_F_min;
var t_F_type;
var t_G_min;
var t_G_type;
var t_H_min;
var t_H_type;
var t_H_max;
var t_I_min;
var t_I_type;
var t_I_max;
var t_J_min;
var t_J_type;

function reload_dec_gui_values()
{
    ch =  Number(ScanaStudio.gui_get_value("ch"));
    speed =  Number(ScanaStudio.gui_get_value("speed"));
    format =  Number(ScanaStudio.gui_get_value("format"));
    suffix = "";

    switch (format)
    {
        case 0:
          format = 10; //dec
          suffix = "";
          break;

        case 1:
          format = 16; //Hex
          suffix = "0x";
          break;

        case 2:
          format = 2; //bin
          suffix = "0b";
          break;

        default: break;
    }
}

// Helper function used to calculate the key parameters of 1-Wire waveforms
// this time are provided by the timing calculation Worksheet of Maxim Integrated
// https://www.maximintegrated.com/en/app-notes/index.mvp/id/126
// https://www.maximintegrated.com/en/tools/other/appnotes/126/AN126-timing-calculation.zip
function setup_1wire_parameters(spd)
{
    if (spd == 0)                             // Standard speed
    {
        t_A_min     = 5e-6;
        t_A_type    = 6e-6;
        t_A_max     = 15e-6;
        t_B_min     = 59e-6;
        t_B_type    = 64e-6;
        t_C_min     = 60e-6;
        t_C_type    = 60e-6;
        t_C_max     = 120e-6;
        t_D_min     = 5.3e-6;
        t_D_type    = 10e-6;
        t_E_min     = 0.3e-6;
        t_E_type    = 9e-6;
        t_E_max     = 9.3e-6;
        t_F_min     = 50e-6;
        t_F_type    = 55e-6;
        t_G_min     = 0;
        t_G_type    = 0;
        t_H_min     = 480e-6;
        t_H_type    = 480e-6;
        t_H_max     = 640e-6;
        t_I_min     = 60.3e-6;
        t_I_type    = 70e-6;
        t_I_max     = 75.3e-6;
        t_J_min     = 410e-6;
        t_J_type    = 410e-6;
    }
    else
    {
        t_A_min     = 1e-6;
        t_A_type    = 1e-6;
        t_A_max     = 2e-6;
        t_B_min     = 7.5e-6;
        t_B_type    = 7.5e-6;
        t_C_min     = 7e-6;
        t_C_type    = 7.5e-6;
        t_C_max     = 14e-6;
        t_D_min     = 2.3e-6;
        t_D_type    = 2.5e-6;
        t_E_min     = 0.6e-6;
        t_E_type    = 1e-6;
        t_E_max     = 1.2e-6;
        t_F_min     = 7e-6;
        t_F_type    = 7e-6;
        t_G_min     = 2.5e-6;
        t_G_type    = 2.5e-6;
        t_H_min     = 68e-6;
        t_H_type    = 70e-6;
        t_H_max     = 80e-6;
        t_I_min     = 7e-6;
        t_I_type    = 8.5e-6;
        t_I_max     = 9.3e-6;
        t_J_min     = 39.5e-6;
        t_J_type    = 40e-6;
    }
}

function t2smpl(time)
{
    return sampling_rate * time;
}

function on_decode_signals(resume)
{
    if (!resume) //If resume == false, it's the first call to this function.
    {
        //initialization code
        reload_dec_gui_values();
        sampling_rate = ScanaStudio.get_capture_sample_rate();
        setup_1wire_parameters(speed);

        ScanaStudio.trs_reset(ch);    // Reset the trs iterator.
        last_rising_edge = -1;
        last_falling_edge = -1;
        previous_edge = -1;
        bit_counter = 0;
        byte = 0;
        sample_points = [];           // Clear array
        state_machine = ENUM_STATE_RESET_F;
    }

    while ( (ScanaStudio.abort_is_requested() == false) && (ScanaStudio.trs_is_not_last(ch) == true) )
    {
        trs = ScanaStudio.trs_get_next(ch);

        switch (state_machine)
        {
            case ENUM_STATE_RESET_F:
            {
                if(trs.value == 0)
                {
                    last_falling_edge = trs.sample_index;
                    state_machine = ENUM_STATE_RESET_R;
                }
                else
                {
                    state_machine = ENUM_STATE_RESET_F;
                }
                break;
            }//end case ENUM_STATE_RESET_F


            case ENUM_STATE_RESET_R:
            {
                if(trs.value == 1)
                {
                    last_rising_edge = trs.sample_index;

                    var pulse_sample_len = last_rising_edge - last_falling_edge;
                    if( (pulse_sample_len <= t2smpl(t_H_max) ) && (pulse_sample_len >= t2smpl(t_H_min)) )//reset detected
                    {
                        ScanaStudio.dec_item_new(ch, last_falling_edge, last_rising_edge);
                        ScanaStudio.dec_item_emphasize_success();
                        ScanaStudio.dec_item_add_content("Master reset pulse");
                        ScanaStudio.dec_item_add_content("Reset pulse");
                        ScanaStudio.dec_item_add_content("Reset");
                        ScanaStudio.dec_item_add_content("R");
                        ScanaStudio.dec_item_add_sample_point(last_falling_edge + t2smpl(t_H_min), "D");
                        ScanaStudio.dec_item_end();

                        ScanaStudio.packet_view_add_packet(true, ch, last_falling_edge, last_rising_edge, "1-Wire", "CH" + (ch + 1), ScanaStudio.get_channel_color(ch), ScanaStudio.get_channel_color(ch));
                        ScanaStudio.packet_view_add_packet(false, ch, last_falling_edge, last_rising_edge, "Reset", "", ScanaStudio.PacketColors.Wrap.Title, ScanaStudio.PacketColors.Wrap.Content);

                        state_machine = ENUM_STATE_PRESENCE_F;
                    }
                }
                else
                {
                    trs = ScanaStudio.trs_get_previous(ch);
                    state_machine = ENUM_STATE_RESET_F;
                }
                break;
            }//end case ENUM_STATE_RESET_R


            case ENUM_STATE_PRESENCE_F:
            {
                if(trs.value == 0)
                {
                    last_falling_edge = trs.sample_index;

                    var pulse_sample_len = last_falling_edge - last_rising_edge;
                    if( pulse_sample_len < t2smpl(t_I_max) )
                    {
                        state_machine = ENUM_STATE_PRESENCE_R;
                    }
                    else
                    {
                        ScanaStudio.dec_item_new(ch, last_rising_edge, last_falling_edge);
                        ScanaStudio.dec_item_add_content("No Presence pulse!");
                        ScanaStudio.dec_item_add_content("No Presence!");
                        ScanaStudio.dec_item_add_content("P!");
                        ScanaStudio.dec_item_add_content("!");
                        ScanaStudio.dec_item_emphasize_warning();
                        ScanaStudio.dec_item_add_sample_point(last_rising_edge + t2smpl(t_I_type), "X");
                        ScanaStudio.dec_item_end();
                        ScanaStudio.packet_view_add_packet(false, ch, last_rising_edge, last_falling_edge, "No Presence", "", ScanaStudio.PacketColors.Error.Title, ScanaStudio.PacketColors.Error.Content);


                        trs = ScanaStudio.trs_get_previous(ch);
                        state_machine = ENUM_STATE_BIT_F;
                    }
                    bit_counter = 0;
                    byte = 0;
                    sample_points = [];
                }
                else
                {
                    state_machine = ENUM_STATE_RESET_F;
                }
                break;
            }//end case ENUM_STATE_PRESENCE_F


            case ENUM_STATE_PRESENCE_R:
            {
                if(trs.value == 1)
                {
                    previous_edge = last_rising_edge;
                    last_rising_edge = trs.sample_index;

                    ScanaStudio.dec_item_new(ch, last_falling_edge, last_rising_edge);
                    ScanaStudio.dec_item_add_content("Presence pulse");
                    ScanaStudio.dec_item_add_content("Presence");
                    ScanaStudio.dec_item_add_content("P");
                    ScanaStudio.dec_item_add_sample_point(previous_edge + t2smpl(t_I_type), "D");
                    ScanaStudio.dec_item_end();

                    ScanaStudio.packet_view_add_packet(false, ch, last_falling_edge, last_rising_edge, "Presence", "", ScanaStudio.PacketColors.Head.Title, ScanaStudio.PacketColors.Head.Content);

                    if( (previous_edge + t2smpl(t_I_min) + t2smpl(t_J_min)) <= last_rising_edge)
                    {
                        trs = ScanaStudio.trs_get_previous(ch);
                        state_machine = ENUM_STATE_RESET_R;
                    }
                    else
                    {
                        state_machine = ENUM_STATE_BIT_F;
                    }
                }
                else
                {
                    trs = ScanaStudio.trs_get_previous(ch);
                    state_machine = ENUM_STATE_RESET_R;
                }
                break;
            }//end case ENUM_STATE_PRESENCE_R


            case ENUM_STATE_BIT_F:
            {
                if(trs.value == 0)
                {
                    last_falling_edge = trs.sample_index;

                    state_machine = ENUM_STATE_BIT_R;
                }
                else
                {
                    trs = ScanaStudio.trs_get_previous(ch);
                    state_machine = ENUM_STATE_RESET_R;
                }
                break;
            }//end case ENUM_STATE_BIT_F


            case ENUM_STATE_BIT_R:
            {
                if(trs.value == 1)
                {
                    last_rising_edge = trs.sample_index;


                    var pulse_sample_len = last_rising_edge - last_falling_edge;
                    if( (pulse_sample_len <= t2smpl(t_A_max) ) && (pulse_sample_len >= t2smpl(t_A_min)-1) )//detection 1
                    {
                        bit_counter++;
                        byte = (byte<<1) | 0x1;
                        sample_points.push(last_falling_edge + t2smpl(t_A_type) + t2smpl(t_E_type));
                    }
                    else if( (pulse_sample_len <= t2smpl(t_C_max) ) && (pulse_sample_len >= t2smpl(t_C_min)-1) )//detection 0
                    {
                        bit_counter++;
                        byte = (byte<<1);
                        sample_points.push(last_falling_edge + t2smpl(t_A_type) + t2smpl(t_E_type));
                    }
                    else
                    {
                        trs = ScanaStudio.trs_get_previous(ch);
                        trs = ScanaStudio.trs_get_previous(ch);
                        state_machine = ENUM_STATE_RESET_R;
                        break;
                    }

                    if(bit_counter == 8)
                    {
                        ScanaStudio.dec_item_new(ch, sample_points[0] - (t2smpl(t_A_type) + t2smpl(t_E_type)), sample_points[7] + t2smpl(t_F_min) - t2smpl(t_E_max) );
                        ScanaStudio.dec_item_add_content(suffix + byte.toString(format));
                        for(var i=0; i<8; i++)
                        {
                            ScanaStudio.dec_item_add_sample_point( sample_points[i], (byte>>(7-i))&0x1 ? "1" : "0");
                        }
                        ScanaStudio.dec_item_end();
                        ScanaStudio.packet_view_add_packet( false,
                                                            ch,
                                                            sample_points[0] - (t2smpl(t_A_type) + t2smpl(t_E_type)),
                                                            sample_points[7] + t2smpl(t_F_min) - t2smpl(t_E_max),
                                                            "Data",
                                                            suffix + byte.toString(format),
                                                            ScanaStudio.PacketColors.Data.Title,
                                                            ScanaStudio.PacketColors.Data.Content);
                        ScanaStudio.hex_view_add_byte(  ch,
                                                        sample_points[0] - (t2smpl(t_A_type) + t2smpl(t_E_type)),
                                                        sample_points[7] + t2smpl(t_F_min) - t2smpl(t_E_max),
                                                        byte);

                        bit_counter = 0;
                        sample_points = [];
                        byte = 0;
                    }
                    state_machine = ENUM_STATE_BIT_F;
                }
                else
                {
                    state_machine = ENUM_STATE_RESET_R;
                }
                break;
            }//end case ENUM_STATE_BIT_R

        }// end switch state_machine
    }//end while


}

//Function called to generate demo siganls (when no physical device is attached)
function on_build_demo_signals()
{
    //Use the function below to get the number of samples to be built
    var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
    var builder = ScanaStudio.BuilderObject;
    reload_dec_gui_values();

    setup_1wire_parameters(speed);

    builder.config(ch, speed, ScanaStudio.builder_get_sample_rate());

    builder.put_silence(10e-3);

    while (ScanaStudio.builder_get_samples_acc(ch) < samples_to_build)
    {
        builder.put_reset_rng();
        builder.put_presence_rng(Math.floor(Math.random()*2));

        var random_size = Math.floor(Math.random() * 10) + 1;
        var w;

        for (w = 0; w < random_size; w++)
        {
            random_data = Math.round(Math.random() * 256);
            builder.put_byte_rng(random_data);
        }
        builder.put_silence(10e-3);
    }
}


var trig_alt;
//Trigger sequence GUI
function on_draw_gui_trigger()
{
    ScanaStudio.gui_add_new_selectable_containers_group("trig_alt","Select trigger type");
        ScanaStudio.gui_add_new_container("Trigger on any valid frame",true);
            ScanaStudio.gui_add_info_label("Trigger on any 1-Wire Frame. In other words,"+
            "this alternative will trigger on Master reset pulse.");
            ScanaStudio.gui_add_check_box("trig_chk_presence", "Only frame with presence bit answwered by slaves", true);
        ScanaStudio.gui_end_container();
        ScanaStudio.gui_add_new_container("Trigger on specific word",false);
            ScanaStudio.gui_add_info_label("Type decimal value (65), Hex value (0x41) or ASCII character ('A')");
            ScanaStudio.gui_add_text_input("trig_byte","Trigger word","");
        ScanaStudio.gui_end_container();
        // ScanaStudio.gui_add_new_container("Trigger on a characters string",false);
        //     ScanaStudio.gui_add_info_label("Type a character string to be used for trigger. E.g.: Hello World");
        //     ScanaStudio.gui_add_text_input("trig_phrase","Trigger phrase","");
        // ScanaStudio.gui_end_container();
    ScanaStudio.gui_end_selectable_containers_group();
}

//Evaluate trigger GUI
function on_eval_gui_trigger()
{
    trig_chk_presence = ScanaStudio.gui_get_value("trig_chk_presence");
    trig_alt = ScanaStudio.gui_get_value("trig_alt");
    trig_byte = ScanaStudio.gui_get_value("trig_byte");
    // trig_phrase = ScanaStudio.gui_get_value("trig_phrase");

    if (trig_alt == 1)
    {
        if (trig_byte.length == 0)
        {
            return "Please specify trigger byte";
        }
        else if (isNaN(trig_byte))
        {
            if ((trig_byte.charAt(0) == "'") && (trig_byte.length < 3))
            {
                return "Invalid character";
            }
            if (trig_byte.length > 3)
            {
                return "Invalid trigger byte: Please enter only one character, e.g. 'a'";
            }
        }
    }
    else if (trig_alt == 2)
    {
        var total_size = 0;
        for (c = 0; c < trig_phrase.length; c++)
        {
            total_size += build_octet(trig_phrase.charCodeAt(c));
        }

        if (total_size > 63)
        {
            return "Trigger phrase too large, please use less characters.";
        }
    }
    return ""; //All good.
}

function on_build_trigger()
{
    trig_chk_presence = ScanaStudio.gui_get_value("trig_chk_presence");
    trig_alt = ScanaStudio.gui_get_value("trig_alt");
    trig_byte = ScanaStudio.gui_get_value("trig_byte");
    // trig_phrase = ScanaStudio.gui_get_value("trig_phrase");

    reload_dec_gui_values();

    setup_1wire_parameters(speed);

    if (trig_alt == 0) //Trig on any byte
    {
        build_master_reset_pulse_step(trig_chk_presence);
    }
    else if(trig_alt == 1) //Trig on one byte
    {
        build_octet(trig_byte);
    }
    else //trig on phrase
    {
        var total_size = 0;
        for (c = 0; c < trig_phrase.length; c++)
        {
            total_size += build_octet(trig_phrase.charCodeAt(c));
        }

        if (total_size > 63)
        {
            ScanaStudio.console_error_msg("Trigger phrase too large, please use less characters.");
        }
    }

    // ScanaStudio.flexitrig_print_steps();
}

function build_master_reset_pulse_step(presence)
{
    var step = "";
    var return_nbr_step = 0;

    for (var i = 0; i < ScanaStudio.get_device_channels_count(); i++)
    {
        if (i == ch)
        {
            step = "F" + step;
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
        if (i == ch)
        {
            step = "R" + step;
        }
        else
        {
            step = "X" + step;
        }
    }

    ScanaStudio.flexitrig_append(step, t_H_min, t_H_max);
    return_nbr_step++;

    if(presence)
    {
        step = "";
        for (var i = 0; i < ScanaStudio.get_device_channels_count(); i++)
        {
            if (i == ch)
            {
                step = "F" + step;
            }
            else
            {
                step = "X" + step;
            }
        }

        ScanaStudio.flexitrig_append(step, -1, t_I_max);
        return_nbr_step++;

        step = "";
        for (var i = 0; i < ScanaStudio.get_device_channels_count(); i++)
        {
            if (i == ch)
            {
                step = "R" + step;
            }
            else
            {
                step = "X" + step;
            }
        }

        ScanaStudio.flexitrig_append(step, -1, t_J_type);
        return_nbr_step++;
    }

    return return_nbr_step;
}

function build_bit(bit)
{
    var step = "";
    var return_nbr_step = 0;

    for (var i = 0; i < ScanaStudio.get_device_channels_count(); i++)
    {
        if (i == ch)
        {
            step = "F" + step;
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
        if (i == ch)
        {
            step = "R" + step;
        }
        else
        {
            step = "X" + step;
        }
    }

    if(bit==1)
    {
        ScanaStudio.flexitrig_append(step, t_A_min, t_A_max);
    }
    else
    {
        ScanaStudio.flexitrig_append(step, t_C_min,  t_C_max);
    }
    return_nbr_step++;

    return return_nbr_step;
}

function build_octet(octet)
{
    var return_nbr_step = 0;

    for(var i=0; i<8; i++)
    {
        return_nbr_step += build_bit((octet>>(7-i))&0x1);
    }

    return return_nbr_step;
}


//Builder object that can be shared to other scripts
ScanaStudio.BuilderObject =
{
    ch: 0,
    speed: 0,
    sampling_rate: 0,

    config : function(channel, spd, sampl_rate)
    {
        this.ch = channel;
        this.speed = spd;
        this.sampling_rate = sampl_rate;
        setup_1wire_parameters(this.speed);
    },

    put_reset : function()
    {
        ScanaStudio.builder_add_samples(this.ch, 1, this.sampling_rate * t_G_type);
        ScanaStudio.builder_add_samples(this.ch, 0, this.sampling_rate * t_H_type);
        ScanaStudio.builder_add_samples(this.ch, 1, 1);
    },

    put_presence : function(presence_bit)
    {
        ScanaStudio.builder_add_samples(this.ch, 1, this.sampling_rate * 0.5 * t_I_type);
        ScanaStudio.builder_add_samples(this.ch, presence_bit, this.sampling_rate * 0.5 * (t_J_type + t_I_type) );
        ScanaStudio.builder_add_samples(this.ch, 1, this.sampling_rate * 0.5 * t_J_type );
    },

    put_silence : function(time)
    {
        ScanaStudio.builder_add_samples(this.ch, 1, this.sampling_rate * time);
    },

    put_bit : function(b)
    {
        if(b == 0)
        {
            ScanaStudio.builder_add_samples(this.ch, 0, this.sampling_rate * t_C_type);
            ScanaStudio.builder_add_samples(this.ch, 1, this.sampling_rate * t_D_type);
        }
        else
        {
            ScanaStudio.builder_add_samples(this.ch, 0, this.sampling_rate * t_A_type);
            ScanaStudio.builder_add_samples(this.ch, 1, this.sampling_rate * t_B_type);
        }
    },

    put_byte : function(byte)
    {
        var b = 0;

        for (b = 0; b < 8; b++)
        {
            this.put_bit((byte >> b) & 0x1);
        }
    },

    put_reset_rng : function()
    {
        var rng;
        rng = t_G_min + (Math.random() * (t_G_type - t_G_min));
        ScanaStudio.builder_add_samples(this.ch, 1, this.sampling_rate * rng);
        rng = t_H_min + (Math.random() * (t_H_max - t_H_min));
        ScanaStudio.builder_add_samples(this.ch, 0, this.sampling_rate * rng);
        ScanaStudio.builder_add_samples(this.ch, 1, 1);
    },

    put_presence_rng : function(presence_bit)
    {
        var rng_i;
        var rng_j;
        rng_i = t_I_min + (Math.random() * (t_I_max - t_I_min));
        rng_j = t_J_min + (Math.random() * (t_J_type - t_J_min));
        ScanaStudio.builder_add_samples(this.ch, 1, this.sampling_rate * 0.5 * rng_i);
        ScanaStudio.builder_add_samples(this.ch, presence_bit, this.sampling_rate * 0.5 * (rng_j + rng_i) );
        ScanaStudio.builder_add_samples(this.ch, 1, this.sampling_rate * 0.5 * rng_j );
    },

    put_bit_rng : function(b)
    {
        var rng;
        if(b == 0)
        {
            rng = t_C_min + (Math.random() * (t_C_max - t_C_min));
            ScanaStudio.builder_add_samples(this.ch, 0, this.sampling_rate * rng);
            rng = t_D_min + (Math.random() * (t_D_type - t_D_min));
            ScanaStudio.builder_add_samples(this.ch, 1, this.sampling_rate * rng);
        }
        else
        {
            rng = t_A_min + (Math.random() * (t_A_max - t_A_min));
            ScanaStudio.builder_add_samples(this.ch, 0, this.sampling_rate * rng);
            rng = t_B_min + (Math.random() * (t_B_type - t_B_min));
            ScanaStudio.builder_add_samples(this.ch, 1, this.sampling_rate * rng);
        }
    },

    put_byte_rng : function(byte)
    {
        var b = 0;

        for (b = 0; b < 8; b++)
        {
            this.put_bit_rng((byte >> b) & 0x1);
        }
    }
};
