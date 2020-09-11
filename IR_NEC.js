/* Protocol meta info:
<NAME> IR_NEC </NAME>
<DESCRIPTION>
Decode the IR NEC protocol.
</DESCRIPTION>
<VERSION> 1.0 </VERSION>
<AUTHOR_NAME> Corentin Maravat </AUTHOR_NAME>
<AUTHOR_URL> contact@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright Ikalogic SAS </COPYRIGHT>
<LICENSE> This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V1.0:  Initial release.
</RELEASE_NOTES>
*/

/*Sources : https://www.sbprojects.net/knowledge/ir/nec.php
https://techdocs.altium.com/display/FPGA/NEC+Infrared+Transmission+Protocol
https://exploreembedded.com/wiki/NEC_IR_Remote_Control_Interface_with_8051
https://www.vishay.com/docs/80071/dataform.pdf
*/


//Decoder GUI
function on_draw_gui_decoder()
{
  //Define decoder configuration GUI
  ScanaStudio.gui_add_ch_selector("ch_nec","IR_NEC Channel","IR_NEC");
  ScanaStudio.gui_add_check_box("extended_adress","Extended adress",false);
  ScanaStudio.gui_add_check_box("burst","Pulse Burst/Single Pulse Mode",true);
  ScanaStudio.gui_add_info_label("Tick if it's Pulse Burst.");
  ScanaStudio.gui_add_check_box("inverted_signal","Inverted Signal",false);
  ScanaStudio.gui_add_info_label("If it is, it means that the space will be HIGH");
  ScanaStudio.gui_add_combo_box("tolerance","Time interval tolerance");
  ScanaStudio.gui_add_item_to_combo_box("10%",true);
  ScanaStudio.gui_add_item_to_combo_box("5%",false);
  ScanaStudio.gui_add_item_to_combo_box("2.5%",false);
  ScanaStudio.gui_add_item_to_combo_box("1%",false);
}

function reload_dec_gui_values()
{
    //get GUI values
    ch_nec = ScanaStudio.gui_get_value("ch_nec");
    extended_adress = ScanaStudio.gui_get_value("extended_adress");
    burst = ScanaStudio.gui_get_value("burst");
    inverted_signal = ScanaStudio.gui_get_value("inverted_signal");
    tolerance = ScanaStudio.gui_get_value("tolerance");
    switch (tolerance)
    {
        case 0 : // 10%
        {
            tolerance = 0.1;
            break;
        }
        case 1 : // 5%
        {
            tolerance = 0.05;
            break;
        }
        case 2 : // 2.5%
        {
            tolerance = 0.025;
            break;
        }
        case 3 : // 1%
        {
            tolerance = 0.01;
            break;
        }
    }
}


//Evaluate decoder GUI
function on_eval_gui_decoder()
{
  return ""; //All good.
}

//Global variables
var sampling_rate;
var state_machine;
var ch_nec;
var nbits;
var item_display = [];
var burst = true;
var inverted_signal = false;
var tolerance = 0;
var last_trs_sample = 0;
var duty_cycle = 1/3;
var extended_adress = false;
var stop_decode = false;
var start_lead_burst = 0;
var end_lead_burst = 0;
var start_lead_space = 0;
var end_lead_space = 0;
var start_adress = 0;
var end_adress = 0;
var start_adress_2 = 0;
var end_adress_2 = 0;
var start_command = 0;
var end_command = 0;
var start_command_2 = 0;
var end_command_2 = 0;
var start_end = 0;
var end_end = 0;
var start_transmission = 0;
var end_transmission = 0;
var time = 0;
var Adress = 0;
var Adress_complement = 0;
var Command = 0;
var Command_complement = 0;
//Packet View
var packet_string = "";
var types = "";
var types_2 = "";
//Variables to display samples points
var bit_sample = 0;
var bit_value = "0";
var bit_sample_array = [];
var bit_value_array = [];
var bit_sample_array_2 = [];
var bit_value_array_2 = [];
// Trigger Variables
var first_step = true;


//decoder state
const   ENUM_STATE_START = 0,
        ENUM_STATE_ADRESS = 1,
        ENUM_STATE_COMMAND = 2,
        ENUM_STATE_END = 3,
        ENUM_STATE_REPEAT = 4,
        ENUM_STATE_UNDEFINED = 10;

const   CONST_t_bit_high            = 2.25e-3,
        CONST_t_bit_low             = 1.125e-3,
        CONST_t_pulse_burst         = 562.5e-6,
        CONST_t_repeat_space        = 2.25e-3,
        CONST_t_repeat              = 110e-3,
        CONST_t_pulse_width         = 8.77e-6,
        CONST_t_pulse_period        = 26.31e-6,
        CONST_t_leading_space       = 4.5e-3,
        CONST_t_leading_pulse_burst = 9e-3;


function on_decode_signals(resume)
{
  if (!resume) //If resume == false, it's the first call to this function.
  {
      //initialization code goes here, ex:
      sampling_rate = ScanaStudio.get_capture_sample_rate();
      reload_dec_gui_values();
      trs_nec = ScanaStudio.trs_reset(ch_nec);
      var trs_nec = ScanaStudio.trs_get_next(ch_nec);
      tmp_trs_sample_index = trs_nec.sample_index;
      while( (tmp_trs_sample_index == trs_nec.sample_index) && (ScanaStudio.trs_is_not_last(ch_nec) == true) )
      {
          trs_nec = ScanaStudio.trs_get_next(ch_nec);
      }
      //init global variables
      state_machine = ENUM_STATE_START;
  }//end if !resume
  else
  {
      //ScanaStudio.console_info_msg("Decoding resumed");
  }


    while (ScanaStudio.abort_is_requested() == false)
    {
        // ScanaStudio.console_info_msg(".");
        if (!ScanaStudio.trs_is_not_last(ch_nec))
        {
            break;
        }
        switch(state_machine)
        {
            case ENUM_STATE_START : // Search for a 9ms leading pulse
            {
                if (inverted_signal == true) //Inverted signal
                {
                    if (trs_nec.value == 0)
                    {
                        start_transmission = trs_nec.sample_index;
                        start_lead_burst = trs_nec.sample_index;
                        last_trs_sample = trs_nec.sample_index;
                        if (burst == true) // Burst Pulse
                        {
                            var n = 0;
                            while (((last_trs_sample - start_lead_burst)/(sampling_rate) <= (1-tolerance)*CONST_t_leading_pulse_burst) || (((trs_nec.sample_index - last_trs_sample)/sampling_rate) <= CONST_t_pulse_period) || n<40) // FAil the decode if it's not burst pulse
                            {
                                last_trs_sample = trs_nec.sample_index;
                                trs_nec = ScanaStudio.trs_get_next(ch_nec);
                                n++;
                                if (!ScanaStudio.trs_is_not_last(ch_nec))
                                {
                                    stop_decode = true;
                                    break;
                                }
                            }
                            if (stop_decode == true)
                            {
                                break;
                            }
                            trs_nec = ScanaStudio.trs_get_previous(ch_nec);
                            if (trs_nec.sample_index == start_lead_burst)
                            {
                                tmp_trs_sample_index = trs_nec.sample_index;
                                while( (tmp_trs_sample_index == trs_nec.sample_index) && (ScanaStudio.trs_is_not_last(ch_nec) == true) )
                                {
                                    trs_nec = ScanaStudio.trs_get_next(ch_nec);
                                }
                            }
                        }
                        else // Normal Pulse
                        {
                            start_lead_burst = trs_nec.sample_index;
                            tmp_trs_sample_index = trs_nec.sample_index;
                            while( (tmp_trs_sample_index == trs_nec.sample_index) && (ScanaStudio.trs_is_not_last(ch_nec) == true) )
                            {
                                trs_nec = ScanaStudio.trs_get_next(ch_nec);
                            }
                        }
                        end_lead_burst = trs_nec.sample_index;
                        time = (end_lead_burst - start_lead_burst)/sampling_rate*1000;
                        ScanaStudio.dec_item_new(ch_nec,start_lead_burst + 1,end_lead_burst - 1);
                        ScanaStudio.dec_item_add_content("Leading pulse (" + time.toFixed(2) + "ms)");
                        ScanaStudio.dec_item_add_content("Leading pulse");
                        ScanaStudio.dec_item_end();
                        // Leading space
                        start_lead_space = end_lead_burst;
                        tmp_trs_sample_index = trs_nec.sample_index;
                        while( (tmp_trs_sample_index == trs_nec.sample_index) && (ScanaStudio.trs_is_not_last(ch_nec) == true) )
                        {
                            trs_nec = ScanaStudio.trs_get_next(ch_nec);
                        }
                        end_lead_space = trs_nec.sample_index; // Should be a rising edge
                        time = (end_lead_space - start_lead_space)/sampling_rate*1000;
                        ScanaStudio.dec_item_new(ch_nec,start_lead_space + 1,end_lead_space - 1);
                        ScanaStudio.dec_item_add_content("Leading Space (" + time.toFixed(2) + "ms)");
                        ScanaStudio.dec_item_add_content("Space (" + time.toFixed(2) + "ms)");
                        ScanaStudio.dec_item_end();
                    }
                    else
                    {
                        trs_nec = ScanaStudio.trs_get_next(ch_nec);
                    }
                }
                else // Not inverted
                {
                    if (trs_nec.value == 1)
                    {
                        start_transmission = trs_nec.sample_index;
                        start_lead_burst = trs_nec.sample_index;
                        last_trs_sample = trs_nec.sample_index;
                        if (burst == true) // Burst Pulse
                        {
                            var n = 0;
                            while (((last_trs_sample - start_lead_burst)/(sampling_rate) <= (1-tolerance)*CONST_t_leading_pulse_burst) || (((trs_nec.sample_index - last_trs_sample)/sampling_rate) <= CONST_t_pulse_period) || n<40) // FAil the decode if it's not burst pulse
                            {
                                last_trs_sample = trs_nec.sample_index;
                                trs_nec = ScanaStudio.trs_get_next(ch_nec);
                                n++;
                                if (!ScanaStudio.trs_is_not_last(ch_nec))
                                {
                                    stop_decode = true;
                                    break;
                                }
                            }
                            if (stop_decode == true)
                            {
                                break;
                            }
                            trs_nec = ScanaStudio.trs_get_previous(ch_nec);
                            if (trs_nec.sample_index == start_lead_burst)
                            {
                                tmp_trs_sample_index = trs_nec.sample_index;
                                while( (tmp_trs_sample_index == trs_nec.sample_index) && (ScanaStudio.trs_is_not_last(ch_nec) == true) )
                                {
                                    trs_nec = ScanaStudio.trs_get_next(ch_nec);
                                }
                            }
                        }
                        else // Normal Pulse
                        {
                            tmp_trs_sample_index = trs_nec.sample_index;
                            while( (tmp_trs_sample_index == trs_nec.sample_index) && (ScanaStudio.trs_is_not_last(ch_nec) == true) )
                            {
                                trs_nec = ScanaStudio.trs_get_next(ch_nec);
                            }
                        }
                        end_lead_burst = trs_nec.sample_index; // Should be a falling edge
                        time = (end_lead_burst - start_lead_burst)/sampling_rate*1000;
                        ScanaStudio.dec_item_new(ch_nec,start_lead_burst + 1,end_lead_burst - 1);
                        ScanaStudio.dec_item_add_content("Leading pulse (" + time.toFixed(2) + "ms)");
                        ScanaStudio.dec_item_add_content("Leading pulse");
                        ScanaStudio.dec_item_end();
                        // Leading space
                        start_lead_space = end_lead_burst;
                        tmp_trs_sample_index = trs_nec.sample_index;
                        while( (tmp_trs_sample_index == trs_nec.sample_index) && (ScanaStudio.trs_is_not_last(ch_nec) == true) )
                        {
                            trs_nec = ScanaStudio.trs_get_next(ch_nec);
                        }
                        end_lead_space = trs_nec.sample_index; // Should be a rising edge
                        time = (end_lead_space - start_lead_space)/sampling_rate*1000;
                        ScanaStudio.dec_item_new(ch_nec,start_lead_space + 1,end_lead_space - 1);
                        ScanaStudio.dec_item_add_content("Space (" + time.toFixed(2) + "ms)");
                        ScanaStudio.dec_item_end();
                    }
                    else
                    {
                        trs_nec = ScanaStudio.trs_get_next(ch_nec);
                    }
                }
                state_machine = ENUM_STATE_ADRESS;
                break;
            }//end ENUM_STATE_START

            case ENUM_STATE_ADRESS :
            {
                //Initialise the arrays
                bit_sample_array = [];
                bit_value_array = [];
                bit_sample_array_2 = [];
                bit_value_array_2 = [];
                start_adress = trs_nec.sample_index;
                last_trs_sample = trs_nec.sample_index;
                start_bit = trs_nec.sample_index;
                if (extended_adress == true)
                {
                    for(i=0; i<16; i++)
                    {
                        var n = 0;
                        while (((trs_nec.sample_index - start_bit)/(sampling_rate) <= (1-tolerance)*CONST_t_pulse_burst) || (((trs_nec.sample_index - last_trs_sample)/sampling_rate) <= CONST_t_pulse_period) || (n<2)) // J'ai mis 1% d'erreur sur la dur�e au hasard atm, par ex sur le signal envoy� par Cuzeau, ca dure 9.06s
                        {
                            last_trs_sample = trs_nec.sample_index;
                            trs_nec = ScanaStudio.trs_get_next(ch_nec);
                            n++;
                            if (!ScanaStudio.trs_is_not_last(ch_nec))
                            {
                                stop_decode = true;
                                break;
                            }
                        }
                        if (stop_decode == true)
                        {
                            break;
                        }
                        if (((trs_nec.sample_index - last_trs_sample)/sampling_rate) > (2*CONST_t_pulse_burst))
                        {
                            bit_sample = last_trs_sample + sampling_rate*CONST_t_pulse_burst;
                            bit_value = "1";
                        }
                        else
                        {
                            bit_sample = last_trs_sample;
                            bit_value = "0";
                        }
                        bit_sample_array.push(bit_sample);
                        bit_value_array.push(bit_value);
                        start_bit = trs_nec.sample_index;
                        last_trs_sample = trs_nec.sample_index;
                    }
                    if (stop_decode == true)
                    {
                        break;
                    }
                    end_adress = trs_nec.sample_index;
                    Adress = bin2dec(bit_value_array);
                    time = (end_adress - start_adress)/sampling_rate*1000;
                    ScanaStudio.dec_item_new(ch_nec,start_adress,end_adress);
                    ScanaStudio.dec_item_add_content("Adress : 0x" + pad(Adress.toString(16),4) + " (" + time.toFixed(2) + "ms)");
                    ScanaStudio.dec_item_add_content("Adress : 0x" + pad(Adress.toString(16),2));
                    ScanaStudio.dec_item_add_content("0x" + pad(Adress.toString(16),2));
                    for (i=0; i<16; i++)
                    {
                        ScanaStudio.dec_item_add_sample_point(bit_sample_array[i],bit_value_array[i].toString(2));
                    }
                    ScanaStudio.dec_item_end();
                    state_machine = ENUM_STATE_COMMAND;
                    break;
                }//end (extend_adress == true)
                else // (extended_adress == false)
                {
                    for(i=0; i<8; i++)
                    {
                        var n = 0;
                        while (((trs_nec.sample_index - start_bit)/(sampling_rate) <= (1-tolerance)*CONST_t_pulse_burst) || (((trs_nec.sample_index - last_trs_sample)/sampling_rate) <= CONST_t_pulse_period) || (n<2))
                        {
                            last_trs_sample = trs_nec.sample_index;
                            trs_nec = ScanaStudio.trs_get_next(ch_nec);
                            n++;
                            if (!ScanaStudio.trs_is_not_last(ch_nec))
                            {
                                stop_decode = true;
                                break;
                            }
                        }
                        if (stop_decode == true)
                        {
                            break;
                        }
                        if (((trs_nec.sample_index - last_trs_sample)/sampling_rate) > (2*CONST_t_pulse_burst))
                        {
                            bit_sample = last_trs_sample + sampling_rate*CONST_t_pulse_burst;
                            bit_value = "1";
                        }
                        else
                        {
                            bit_sample = last_trs_sample;
                            bit_value = "0";
                        }
                        bit_sample_array.push(bit_sample);
                        bit_value_array.push(bit_value);
                        start_bit = trs_nec.sample_index;
                        last_trs_sample = trs_nec.sample_index;
                    }
                    if (stop_decode == true)
                    {
                        break;
                    }
                    end_adress = trs_nec.sample_index;
                    Adress = bin2dec(bit_value_array);
                    time = (end_adress - start_adress)/sampling_rate*1000;
                    ScanaStudio.dec_item_new(ch_nec,start_adress,end_adress);
                    ScanaStudio.dec_item_add_content("Adress : 0x" + pad(Adress.toString(16),2) + " (" + time.toFixed(2) + "ms)");
                    ScanaStudio.dec_item_add_content("Adress : 0x" + pad(Adress.toString(16),2));
                    ScanaStudio.dec_item_add_content("0x" + pad(Adress.toString(16),2));
                    for (i=0; i<8; i++)
                    {
                        ScanaStudio.dec_item_add_sample_point(bit_sample_array[i],bit_value_array[i].toString(2));
                    }
                    ScanaStudio.dec_item_end();
                    // Start of Complement of Adress
                    tmp_trs_sample_index = trs_nec.sample_index;
                    while( (tmp_trs_sample_index == trs_nec.sample_index) && (ScanaStudio.trs_is_not_last(ch_nec) == true) )
                    {
                        trs_nec = ScanaStudio.trs_get_next(ch_nec);
                    }
                    start_adress_2 = end_adress;
                    last_trs_sample = trs_nec.sample_index;
                    start_bit = trs_nec.sample_index;
                    for(i=0; i<8; i++)
                    {
                        n = 0;
                        if (i == 0)
                        {
                            n = 1;
                        }
                        while (((trs_nec.sample_index - start_bit)/(sampling_rate) <= (1-tolerance)*CONST_t_pulse_burst) || (((trs_nec.sample_index - last_trs_sample)/sampling_rate) <= CONST_t_pulse_period)  || (n<2))
                        {
                            last_trs_sample = trs_nec.sample_index;
                            trs_nec = ScanaStudio.trs_get_next(ch_nec);
                            n++;
                            if (!ScanaStudio.trs_is_not_last(ch_nec))
                            {
                                stop_decode = true;
                                break;
                            }
                        }
                        if (stop_decode == true)
                        {
                            break;
                        }
                        if (((trs_nec.sample_index - last_trs_sample)/sampling_rate) > (2*CONST_t_pulse_burst))
                        {
                            bit_sample = last_trs_sample + sampling_rate*CONST_t_pulse_burst;
                            bit_value = 1;
                        }
                        else
                        {
                            bit_sample = last_trs_sample;
                            bit_value = 0;
                        }
                        bit_sample_array_2.push(bit_sample);
                        bit_value_array_2.push(bit_value);
                        start_bit = trs_nec.sample_index;
                        last_trs_sample = trs_nec.sample_index;
                    }
                    if (stop_decode == true)
                    {
                        break;
                    }
                    end_adress_2 = trs_nec.sample_index;
                    time = (end_adress_2 - start_adress_2)/sampling_rate*1000;
                    Adress_complement = bin2dec(bit_value_array_2);
                    ScanaStudio.dec_item_new(ch_nec,start_adress_2,end_adress_2);
                    var test = 0;
                    for (i=0; i<8; i++)
                    {
                        ScanaStudio.dec_item_add_sample_point(bit_sample_array_2[i], bit_value_array_2[i].toString(2));
                        if (bit_value_array_2[i] == bit_value_array[i])
                        {
                            test = 1;
                        }
                    }
                    if (test == 1)
                    {
                        ScanaStudio.dec_item_emphasize_error();
                        ScanaStudio.dec_item_add_content("Complement of Adress is incorrect, 0x" + pad(Adress_complement.toString(16),2) + " (" + time.toFixed(2) + "ms)");
                        ScanaStudio.dec_item_add_content("Complement of Adress is incorrect, 0x" + pad(Adress_complement.toString(16),2));
                        ScanaStudio.dec_item_add_content("0x" + pad(Adress_complement.toString(16),2));
                        types = ScanaStudio.PacketColors.Error.Title;
                        types_2 = ScanaStudio.PacketColors.Error.Content;
                    }
                    else
                    {
                        ScanaStudio.dec_item_add_content("Complement of Adress : 0x" + pad(Adress_complement.toString(16),2) + " (" + time.toFixed(2) + "ms)");
                        ScanaStudio.dec_item_add_content("Complement of Adress : 0x" + pad(Adress_complement.toString(16),2));
                        ScanaStudio.dec_item_add_content("0x" + pad(Adress_complement.toString(16),2));
                        types = ScanaStudio.PacketColors.Check.Title;
                        types_2 = ScanaStudio.PacketColors.Check.Content;
                    }
                    ScanaStudio.dec_item_end();
                    state_machine = ENUM_STATE_COMMAND;
                    break;
                }//end (extend_adress == false)
            }//end ENUM_STATE_ADRESS

            case ENUM_STATE_COMMAND :
            {
                //Initialise the arrays
                bit_sample_array = [];
                bit_value_array = [];
                bit_sample_array_2 = [];
                bit_value_array_2 = [];
                tmp_trs_sample_index = trs_nec.sample_index;
                while( (tmp_trs_sample_index == trs_nec.sample_index) && (ScanaStudio.trs_is_not_last(ch_nec) == true) )
                {
                    trs_nec = ScanaStudio.trs_get_next(ch_nec);
                }
                if (extended_adress == true)
                {
                    start_command = end_adress;
                }
                else
                {
                    start_command = end_adress_2;
                }
                last_trs_sample = trs_nec.sample_index;
                start_bit = trs_nec.sample_index;
                for(i=0; i<8; i++)
                {
                    n = 0;
                    if (i == 0)
                    {
                        n = 1;
                    }
                    while (((trs_nec.sample_index - start_bit)/(sampling_rate) <= (1-tolerance)*CONST_t_pulse_burst) || (((trs_nec.sample_index - last_trs_sample)/sampling_rate) <= CONST_t_pulse_period)  || (n<2))
                    {
                        last_trs_sample = trs_nec.sample_index;
                        trs_nec = ScanaStudio.trs_get_next(ch_nec);
                        if (!ScanaStudio.trs_is_not_last(ch_nec))
                        {
                            stop_decode = true;
                            break;
                        }
                        n++;
                    }
                    if (stop_decode == true)
                    {
                        break;
                    }
                    if (((trs_nec.sample_index - last_trs_sample)/sampling_rate) > (2*CONST_t_pulse_burst))
                    {
                        bit_sample = last_trs_sample + sampling_rate*CONST_t_pulse_burst;
                        bit_value = "1";
                    }
                    else
                    {
                        bit_sample = last_trs_sample;
                        bit_value = "0";
                    }
                    bit_sample_array.push(bit_sample);
                    bit_value_array.push(bit_value);
                    start_bit = trs_nec.sample_index;
                    last_trs_sample = trs_nec.sample_index;
                }
                if (stop_decode == true)
                {
                    break;
                }
                end_command = trs_nec.sample_index;
                Command = bin2dec(bit_value_array);
                time = (end_command - start_command)/sampling_rate*1000;
                ScanaStudio.dec_item_new(ch_nec,start_command,end_command);
                ScanaStudio.dec_item_add_content("Command : 0x" + pad(Command.toString(16),2) + " (" + time.toFixed(2) + "ms)");
                ScanaStudio.dec_item_add_content("Command : 0x" + pad(Command.toString(16),2));
                ScanaStudio.dec_item_add_content("0x" + pad(Command.toString(16),2));
                for (i=0; i<8; i++)
                {
                    ScanaStudio.dec_item_add_sample_point(bit_sample_array[i],bit_value_array[i].toString(2));
                }
                ScanaStudio.dec_item_end();
                // Start of Complement of Adress
                tmp_trs_sample_index = trs_nec.sample_index;
                while( (tmp_trs_sample_index == trs_nec.sample_index) && (ScanaStudio.trs_is_not_last(ch_nec) == true) )
                {
                    trs_nec = ScanaStudio.trs_get_next(ch_nec);
                }
                start_command_2 = end_command;
                last_trs_sample = trs_nec.sample_index;
                start_bit = trs_nec.sample_index;
                for(i=0; i<8; i++)
                {
                    n = 0;
                    if (i == 0)
                    {
                        n = 1;
                    }
                    while (((trs_nec.sample_index - start_bit)/(sampling_rate) <= (1-tolerance)*CONST_t_pulse_burst) || (((trs_nec.sample_index - last_trs_sample)/sampling_rate) <= CONST_t_pulse_period)  || (n<2))
                    {
                        last_trs_sample = trs_nec.sample_index;
                        trs_nec = ScanaStudio.trs_get_next(ch_nec);
                        n++;
                        if (!ScanaStudio.trs_is_not_last(ch_nec))
                        {
                            stop_decode = true;
                            break;
                        }
                    }
                    if (stop_decode == true)
                    {
                        break;
                    }
                    if (((trs_nec.sample_index - last_trs_sample)/sampling_rate) > (2*CONST_t_pulse_burst))
                    {
                        bit_sample = last_trs_sample + sampling_rate*CONST_t_pulse_burst;
                        bit_value = 1;
                    }
                    else
                    {
                        bit_sample = last_trs_sample;
                        bit_value = 0;
                    }
                    bit_sample_array_2.push(bit_sample);
                    bit_value_array_2.push(bit_value);
                    start_bit = trs_nec.sample_index;
                    last_trs_sample = trs_nec.sample_index;
                }
                if (stop_decode == true)
                {
                    break;
                }
                end_command_2 = trs_nec.sample_index;
                Command_complement = bin2dec(bit_value_array_2);
                time = (end_command_2 - start_command_2)/sampling_rate*1000;
                ScanaStudio.dec_item_new(ch_nec,start_command_2 + 1,end_command_2 - 1);
                test = 0;
                for (i=0; i<8; i++)
                {
                    ScanaStudio.dec_item_add_sample_point(bit_sample_array_2[i], bit_value_array_2[i].toString(2));
                    if (bit_value_array_2[i] == bit_value_array[i])
                    {
                        test = 1;
                    }
                }
                if (test == 1)
                {
                    ScanaStudio.dec_item_emphasize_error();
                    ScanaStudio.dec_item_add_content("Complement of Command is incorrect, 0x" + pad(Command_complement.toString(16),2) + " (" + time.toFixed(2) + "ms)");
                    ScanaStudio.dec_item_add_content("Complement of Command is incorrect, 0x" + pad(Command_complement.toString(16),2));
                    ScanaStudio.dec_item_add_content("0x" + pad(Command_complement.toString(16),2));
                    types = ScanaStudio.PacketColors.Error.Title;
                    types_2 = ScanaStudio.PacketColors.Error.Content;
                }
                else
                {
                    ScanaStudio.dec_item_add_content("Complement of Command : 0x" + pad(Command_complement.toString(16),2) + " (" + time.toFixed(2) + "ms)");
                    ScanaStudio.dec_item_add_content("Complement of Command : 0x" + pad(Command_complement.toString(16),2));
                    ScanaStudio.dec_item_add_content("0x" + pad(Command_complement.toString(16),2));
                    types = ScanaStudio.PacketColors.Check.Title;
                    types_2 = ScanaStudio.PacketColors.Check.Content;
                }
                ScanaStudio.dec_item_end();
                state_machine = ENUM_STATE_END;
                break;
            }//end ENUM_STATE_COMMAND

            case ENUM_STATE_END :
            {
                start_end = trs_nec.sample_index;
                last_trs_sample = trs_nec.sample_index;
                while (((trs_nec.sample_index - start_end)/(sampling_rate) <= (1-tolerance)*CONST_t_pulse_burst) || (((trs_nec.sample_index - last_trs_sample)/sampling_rate) <= CONST_t_pulse_period) )
                {
                    last_trs_sample = trs_nec.sample_index;
                    trs_nec = ScanaStudio.trs_get_next(ch_nec);
                    if (!ScanaStudio.trs_is_not_last(ch_nec))
                    {
                        stop_decode = true;
                        break;
                    }
                }
                if (stop_decode == true)
                {
                    break;
                }
                trs_nec = ScanaStudio.trs_get_previous(ch_nec);
                if (trs_nec.sample_index == start_end)
                {
                    tmp_trs_sample_index = trs_nec.sample_index;
                    while( (tmp_trs_sample_index == trs_nec.sample_index) && (ScanaStudio.trs_is_not_last(ch_nec) == true) )
                    {
                        trs_nec = ScanaStudio.trs_get_next(ch_nec);
                    }
                }
                end_end = trs_nec.sample_index; // Should be a falling edge
                end_transmission = trs_nec.sample_index;
                time = (end_end - start_end)/sampling_rate*1000;
                ScanaStudio.dec_item_new(ch_nec,start_end + 1,end_end - 1);
                ScanaStudio.dec_item_add_content("End (" + time.toFixed(2) + "ms)");
                ScanaStudio.dec_item_add_content("End");
                ScanaStudio.dec_item_add_content("E");
                ScanaStudio.dec_item_end();
                tmp_trs_sample_index = trs_nec.sample_index;
                while( (tmp_trs_sample_index == trs_nec.sample_index) && (ScanaStudio.trs_is_not_last(ch_nec) == true) )
                {
                    trs_nec = ScanaStudio.trs_get_next(ch_nec);
                }
                // Create all the packet_view
                var transmission_time = ((end_transmission-start_transmission)/sampling_rate*1000).toFixed(2);
                ScanaStudio.packet_view_add_packet( true,
                    ch_nec,
                    start_transmission,
                    end_transmission,
                    "NEC IR",
                    "Transmission (" + transmission_time + "ms)",
                    ScanaStudio.PacketColors.Head.Title,
                    ScanaStudio.PacketColors.Head.Content);
                ScanaStudio.packet_view_add_packet( false,
                    ch_nec,
                    start_lead_burst,
                    end_lead_burst,
                    "Start pulse",
                    "Leading pulse burst",
                    ScanaStudio.PacketColors.Misc.Title,
                    ScanaStudio.PacketColors.Misc.Content);
                ScanaStudio.packet_view_add_packet( false,
                    ch_nec,
                    start_lead_space,
                    end_lead_space,
                    "Start pulse",
                    "Leading pulse space",
                    ScanaStudio.PacketColors.Misc.Title,
                    ScanaStudio.PacketColors.Misc.Content);
                if (extended_adress == true)
                {
                    packet_string = "0x" + pad(Adress.toString(16),4);
                    ScanaStudio.packet_view_add_packet( false,
                        ch_nec,
                        start_adress,
                        end_adress,
                        "Adress",
                        packet_string,
                        ScanaStudio.PacketColors.Data.Title,
                        ScanaStudio.PacketColors.Data.Content);
                }
                else
                {
                    packet_string = "0x" + pad(Adress.toString(16),2);
                    ScanaStudio.packet_view_add_packet( false,
                        ch_nec,
                        start_adress,
                        end_adress,
                        "Adress",
                        packet_string,
                        ScanaStudio.PacketColors.Data.Title,
                        ScanaStudio.PacketColors.Data.Content);
                    packet_string = "0x" + pad(Adress_complement.toString(16),2);
                    ScanaStudio.packet_view_add_packet( false,
                        ch_nec,
                        start_adress_2,
                        end_adress_2,
                        "Adress complement",
                        packet_string,
                        types,
                        types_2);
                }
                packet_string = "0x" + pad(Command.toString(16),2);
                ScanaStudio.packet_view_add_packet( false,
                    ch_nec,
                    start_command,
                    end_command,
                    "Command",
                    packet_string,
                    ScanaStudio.PacketColors.Data.Title,
                    ScanaStudio.PacketColors.Data.Content);
                packet_string = "0x" + pad(Command_complement.toString(16),2);
                ScanaStudio.packet_view_add_packet( false,
                    ch_nec,
                    start_command_2,
                    end_command_2,
                    "Command complement",
                    packet_string,
                    types,
                    types_2);
                ScanaStudio.packet_view_add_packet( false,
                    ch_nec,
                    start_end,
                    end_end,
                    "End Burst",
                    "End",
                    ScanaStudio.PacketColors.Wrap.Title,
                    ScanaStudio.PacketColors.Wrap.Content);
                state_machine = ENUM_STATE_REPEAT;
                break;
            }//end ENUM_STATE_RESET

            case ENUM_STATE_REPEAT :
            {
                // Check if there is a Repeat Code
                start_item = trs_nec.sample_index;
                last_trs_sample = trs_nec.sample_index;
                // The leading pulse
                if (burst == true)
                {
                    while (((trs_nec.sample_index - start_item)/(sampling_rate) <= (1-tolerance)*CONST_t_leading_pulse_burst) || (((trs_nec.sample_index - last_trs_sample)/sampling_rate) <= CONST_t_pulse_period) )
                    {
                        last_trs_sample = trs_nec.sample_index;
                        trs_nec = ScanaStudio.trs_get_next(ch_nec);
                        if (!ScanaStudio.trs_is_not_last(ch_nec))
                        {
                            stop_decode = true;
                            break;
                        }
                    }
                    if (stop_decode == true)
                    {
                        break;
                    }
                    trs_nec = ScanaStudio.trs_get_previous(ch_nec);
                    tmp_trs_sample_index = trs_nec.sample_index;
                    while( (tmp_trs_sample_index == trs_nec.sample_index) && (ScanaStudio.trs_is_not_last(ch_nec) == true) )
                    {
                        trs_nec = ScanaStudio.trs_get_next(ch_nec);
                    }
                    start_bit = trs_nec.sample_index;
                    while (((trs_nec.sample_index - start_bit)/(sampling_rate) <= CONST_t_pulse_burst) || (((trs_nec.sample_index - last_trs_sample)/sampling_rate) <= CONST_t_pulse_period) )
                    {
                        last_trs_sample = trs_nec.sample_index;
                        trs_nec = ScanaStudio.trs_get_next(ch_nec);
                    }
                }
                else // Normal Pulse Mode
                {
                    // Leading Pulse
                    tmp_trs_sample_index = trs_nec.sample_index;
                    while( (tmp_trs_sample_index == trs_nec.sample_index) && (ScanaStudio.trs_is_not_last(ch_nec) == true) )
                    {
                        trs_nec = ScanaStudio.trs_get_next(ch_nec);
                    }
                    // Leading Space
                    last_trs_sample = trs_nec.sample_index;
                    tmp_trs_sample_index = trs_nec.sample_index;
                    while( (tmp_trs_sample_index == trs_nec.sample_index) && (ScanaStudio.trs_is_not_last(ch_nec) == true) )
                    {
                        trs_nec = ScanaStudio.trs_get_next(ch_nec);
                    }
                    // Burst
                    start_bit = trs_nec.sample_index;
                    tmp_trs_sample_index = trs_nec.sample_index;
                    while( (tmp_trs_sample_index == trs_nec.sample_index) && (ScanaStudio.trs_is_not_last(ch_nec) == true) )
                    {
                        trs_nec = ScanaStudio.trs_get_next(ch_nec);
                    }
                    tmp_trs_sample_index = trs_nec.sample_index;
                    while( (tmp_trs_sample_index == trs_nec.sample_index) && (ScanaStudio.trs_is_not_last(ch_nec) == true) )
                    {
                        trs_nec = ScanaStudio.trs_get_next(ch_nec);
                    }
                }
                if ((trs_nec.sample_index - start_bit)/(sampling_rate) >= CONST_t_bit_high*1.5)
                {
                    end_item = trs_nec.sample_index;
                    time = (end_item - start_item)/sampling_rate*1000;
                    ScanaStudio.dec_item_new(ch_nec,start_item,end_item);
                    ScanaStudio.dec_item_add_content("Repeat Code (" + time.toFixed(2) + "ms)");
                    ScanaStudio.dec_item_add_content("Repeat Code");
                    ScanaStudio.dec_item_end();
                    // Packet view
                    ScanaStudio.packet_view_add_packet( false,
                                                        ch_nec,
                                                        start_item,
                                                        end_item,
                                                        "Repeat Code",
                                                        "Repeat Code",
                                                        ScanaStudio.PacketColors.Data.Title,
                                                        ScanaStudio.PacketColors.Data.Content);
                    break;
                }
                else
                {
                    trs_nec = ScanaStudio.trs_get_before(ch_nec, start_item + 1);
                    state_machine = ENUM_STATE_START;
                }
            }
        }//end switch (state_machine)
    }//end while (ScanaStudio.abort_is_requested() == false)
}//end on_decode_signals


//Trigger sequence GUI
function on_draw_gui_trigger()
{
    ScanaStudio.gui_add_info_label("The trigger is only working if the signal is in Normal Pulse Mode");
  ScanaStudio.gui_add_new_selectable_containers_group("trig_alternative","Select trigger alternative");
  ScanaStudio.gui_add_new_container("Trigger on a specific adress + command",true); // trig_alternative = 0
  ScanaStudio.gui_add_text_input("trig_adress","Trigger Adress value","0xA5");
  ScanaStudio.gui_add_text_input("trig_command","Trigger Command value","0xA5");
  ScanaStudio.gui_add_info_label("Choose an adress/command value between 0 and 255,"
  + "if extended adress is implemented you can go to 65535 for the adress."
  + " These fields can accept decimal value (165), hex value (0x).");
  ScanaStudio.gui_end_container();

  ScanaStudio.gui_add_new_container("Trigger on a specific adress",false); // trig_alternative = 1
  ScanaStudio.gui_add_text_input("trig_value","Trigger adress value","0xA5");
  ScanaStudio.gui_add_info_label("Choose an adress value between 0 and 255, if extended adress is implemented you can go to 65535." +
  " The field can accept decimal value (165), hex value (0x).");

  ScanaStudio.gui_end_container();

  ScanaStudio.gui_add_new_container("Trigger on any start transaction",false); // trig_alternative = 2
  ScanaStudio.gui_end_container();
  ScanaStudio.gui_end_selectable_containers_group("");
  ScanaStudio.gui_add_check_box("trig_extended_adress","Extended adress",false);

}//end on_draw_gui_trigger

function on_eval_gui_trigger()
{
    if (Number((ScanaStudio.gui_get_value("trig_adress")) > 255) || (Number(ScanaStudio.gui_get_value("trig_adress")) < 0))
    {
        if((Number(ScanaStudio.gui_get_value("trig_adress"))) > 255 && (Number(ScanaStudio.gui_get_value("trig_extended_adress")) == true))
        {
            // do nothing
        }
        else
        {
            return "Invalid trigger adress, please select a number between 0 and 255";
        }
    }

    if ((Number(ScanaStudio.gui_get_value("trig_command")) > 255) || (Number(ScanaStudio.gui_get_value("trig_command")) < 0))
    {
        return "Invalid trigger command, please select a number between 0 and 255";
    }

    if ((Number(ScanaStudio.gui_get_value("trig_value")) > 255) || (Number(ScanaStudio.gui_get_value("trig_value")) < 0))
    {
        if((Number(ScanaStudio.gui_get_value("trig_value")) > 255) && (ScanaStudio.gui_get_value("trig_extended_adress") == true))
        {
            // do nothing it's fine
        }
        else
        {
            return "Invalid trigger adress, please select a number between 0 and 255";
        }
    }

    return "";
}//end on_eval_gui_trigger

function on_build_trigger()
{
  var trig_adress = Number(ScanaStudio.gui_get_value("trig_adress"));
  var trig_command = Number(ScanaStudio.gui_get_value("trig_command"));
  var trig_value = Number(ScanaStudio.gui_get_value("trig_value"));
  var trig_alternative = Number(ScanaStudio.gui_get_value("trig_alternative"));
  var trig_extended_adress = ScanaStudio.gui_get_value("trig_extended_adress");
  // Reload Decoder GUI values (global variables)
  reload_dec_gui_values();
  var first_step = true;

  if (trig_alternative == 0) //Trigger on a specific adress + command
  {
      // Adress
      if (trig_extended_adress == true)
      {
          for (n=0; n<16; n++)
          {
              if(((trig_adress>>n)&0x1) == 1)
              {
                  HighTrigStep();
              }
              else
              {
                  LowTrigStep();
              }
          }
      }
      else
      {
          for (n=0; n<8; n++)
          {
              if(((trig_adress>>n)&0x1) == 1)
              {
                  HighTrigStep();
              }
              else
              {
                  LowTrigStep();
              }
          }
          for (n=0; n<8; n++)
          {
              if(((trig_adress>>n)&0x1) == 1)
              {
                  LowTrigStep();
              }
              else
              {
                  HighTrigStep();
              }
          }
      }
      // Command
      for (n=0; n<8; n++)
      {
          if(((trig_command>>n)&0x1) == 1)
          {
              HighTrigStep();
          }
          else
          {
              LowTrigStep();
          }
      }
      for (n=0; n<8; n++)
      {
          if(((trig_command>>n)&0x1) == 1)
          {
              LowTrigStep();
          }
          else
          {
              HighTrigStep();
          }
      }
  }//end Trigger on a specific adress + command

  else if (trig_alternative == 1) //Trigger on a specific adress
  {
      if (trig_extended_adress == true)
      {
          for (n=0; n<16; n++)
          {
              if(((trig_value>>n)&0x1) == 1)
              {
                  HighTrigStep();
              }
              else
              {
                  LowTrigStep();
              }
          }
      }
      else
      {
          for (n=0; n<8; n++)
          {
              if(((trig_value>>n)&0x1) == 1)
              {
                  HighTrigStep();
              }
              else
              {
                  LowTrigStep();
              }
          }
          for (n=0; n<8; n++)
          {
              if(((trig_value>>n)&0x1) == 1)
              {
                  LowTrigStep();
              }
              else
              {
                  HighTrigStep();
              }
          }
      }
  }//end Trigger on a specific adress or command

  else if (trig_alternative == 2) // Trigger on any start transaction
  {
      if (inverted_signal == false)
      {
      ScanaStudio.flexitrig_append(trig_build_step("R"),-1,-1);
      ScanaStudio.flexitrig_append(trig_build_step("F"),(1-tolerance)*CONST_t_leading_pulse_burst,(1+tolerance)*CONST_t_leading_pulse_burst);
      ScanaStudio.flexitrig_append(trig_build_step("R"),(1-tolerance)*CONST_t_leading_space,(1+tolerance)*CONST_t_leading_space);
      }
      else
      {
          ScanaStudio.flexitrig_append(trig_build_step("F"),-1,-1);
          ScanaStudio.flexitrig_append(trig_build_step("R"),(1-tolerance)*CONST_t_leading_pulse_burst,(1+tolerance)*CONST_t_leading_pulse_burst);
          ScanaStudio.flexitrig_append(trig_build_step("F"),(1-tolerance)*CONST_t_leading_space,(1+tolerance)*CONST_t_leading_space);
      }
  }//end Trigger on any start transaction

  ScanaStudio.flexitrig_print_steps();
}//end on_build_trigger



function HighTrigStep ()
{
    if (first_step)
    {
        first_step = false;
        if (inverted_signal == true)
        {
            ScanaStudio.flexitrig_append(trig_build_step("F"),-1,-1);
            ScanaStudio.flexitrig_append(trig_build_step("R"),(1-tolerance)*CONST_t_pulse_burst,(1+tolerance)*CONST_t_pulse_burst);
            ScanaStudio.flexitrig_append(trig_build_step("F"),(1-tolerance)*CONST_t_pulse_burst*3,(1+tolerance)*CONST_t_pulse_burst*3);
        }
        else
        {
            ScanaStudio.flexitrig_append(trig_build_step("R"),-1,-1);
            ScanaStudio.flexitrig_append(trig_build_step("F"),(1-tolerance)*CONST_t_pulse_burst,(1+tolerance)*CONST_t_pulse_burst);
            ScanaStudio.flexitrig_append(trig_build_step("R"),(1-tolerance)*CONST_t_pulse_burst*3,(1+tolerance)*CONST_t_pulse_burst*3);
        }
    }
    else
    {
        if (inverted_signal == true)
        {
            ScanaStudio.flexitrig_append(trig_build_step("R"),(1-tolerance)*CONST_t_pulse_burst,(1+tolerance)*CONST_t_pulse_burst);
            ScanaStudio.flexitrig_append(trig_build_step("F"),(1-tolerance)*CONST_t_pulse_burst*3,(1+tolerance)*CONST_t_pulse_burst*3);
        }
        else
        {
            ScanaStudio.flexitrig_append(trig_build_step("F"),(1-tolerance)*CONST_t_pulse_burst,(1+tolerance)*CONST_t_pulse_burst);
            ScanaStudio.flexitrig_append(trig_build_step("R"),(1-tolerance)*CONST_t_pulse_burst*3,(1+tolerance)*CONST_t_pulse_burst*3);
        }
    }
};

function LowTrigStep ()
{
    if (first_step)
    {
        first_step = false;
        if (inverted_signal == true)
        {
            ScanaStudio.flexitrig_append(trig_build_step("F"),-1,-1);
            ScanaStudio.flexitrig_append(trig_build_step("R"),(1-tolerance)*CONST_t_pulse_burst,(1+tolerance)*CONST_t_pulse_burst);
            ScanaStudio.flexitrig_append(trig_build_step("F"),(1-tolerance)*CONST_t_pulse_burst,(1+tolerance)*CONST_t_pulse_burst);
        }
        else
        {
            ScanaStudio.flexitrig_append(trig_build_step("R"),-1,-1);
            ScanaStudio.flexitrig_append(trig_build_step("F"),(1-tolerance)*CONST_t_pulse_burst,(1+tolerance)*CONST_t_pulse_burst);
            ScanaStudio.flexitrig_append(trig_build_step("R"),(1-tolerance)*CONST_t_pulse_burst,(1+tolerance)*CONST_t_pulse_burst);
        }
    }
    else
    {
        if (inverted_signal == true)
        {
            ScanaStudio.flexitrig_append(trig_build_step("R"),(1-tolerance)*CONST_t_pulse_burst,(1+tolerance)*CONST_t_pulse_burst);
            ScanaStudio.flexitrig_append(trig_build_step("F"),(1-tolerance)*CONST_t_pulse_burst,(1+tolerance)*CONST_t_pulse_burst);
        }
        else
        {
            ScanaStudio.flexitrig_append(trig_build_step("F"),(1-tolerance)*CONST_t_pulse_burst,(1+tolerance)*CONST_t_pulse_burst);
            ScanaStudio.flexitrig_append(trig_build_step("R"),(1-tolerance)*CONST_t_pulse_burst,(1+tolerance)*CONST_t_pulse_burst);
        }
    }
};



function trig_build_step (step_desc)
{
	var i;
	var step = "";

	for (i = 0; i < ScanaStudio.get_device_channels_count(); i++)
	{
        switch (i)
        {
            case ch_nec: step = step_desc + step; break;
            default:      step = "X" + step; break;
        }
	}
	return step;
}

//Function called to generate demo signals (when no physical device is attached)
function on_build_demo_signals()
{
    //Use the function below to get the number of samples to be built
    var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
    var nec_builder = ScanaStudio.BuilderObject;
    var sample_rate = ScanaStudio.builder_get_sample_rate();
    var ch_nec = ScanaStudio.gui_get_value("ch_nec");
    var silence_period = samples_to_build/100;
    reload_dec_gui_values();
    var duty_cycle = 1/3;
        nec_builder.config(ch_nec, sample_rate, duty_cycle);

    nec_builder.put_silence(10);
    nec_builder.put_lead(); //start of the transmission
    nec_builder.put_rand_adress(); //Adress
    nec_builder.put_rand_command(); //Command
    nec_builder.put_end(); //end of the transmission
    nec_builder.put_repeat();
    nec_builder.put_repeat();

    nec_builder.put_lead(); //start of the transmission
    nec_builder.put_rand_adress(); //Adress
    nec_builder.put_rand_command(); //Command
    nec_builder.put_end(); //end of the transmission

     while( ScanaStudio.builder_get_samples_acc(ch_nec) < samples_to_build )
     {
         var rng = Math.floor(Math.random()*2);
         if (rng == 1)
         {
             nec_builder.put_lead(); //start of the transmission
             nec_builder.put_rand_adress(); //Adress
             nec_builder.put_rand_command(); //Command
             nec_builder.put_end(); //end of the transmission
         }
         else
         {
             nec_builder.put_repeat();
         }
     }
}

//Builder object that can be shared to other scripts
ScanaStudio.BuilderObject =
{
    put_burst : function()
    {
        if (inverted_signal == false)
        {
            ScanaStudio.builder_add_samples(this.ch_nec,1,this.samples_high_per_burst);
            ScanaStudio.builder_add_samples(this.ch_nec,0,this.samples_low_per_burst);
        }
        else
        {
            ScanaStudio.builder_add_samples(this.ch_nec,0,this.samples_high_per_burst);
            ScanaStudio.builder_add_samples(this.ch_nec,1,this.samples_low_per_burst);
        }
    },

    put_bit : function(lvl)
    {
        if (burst == true)
        {
            if (lvl == 1) // Put a high bit
            {
                for (i=0; i<CONST_t_pulse_burst/CONST_t_pulse_period; i++) // Put the burst part
                {
                    this.put_burst();
                }
                // Put the space part
                if (inverted_signal == false)
                {
                    ScanaStudio.builder_add_samples(ch_nec,0,this.sample_per_pulse_burst*3);
                }
                else
                {
                    ScanaStudio.builder_add_samples(ch_nec,1,this.sample_per_pulse_burst*3);
                }
            }
            else // Put a low bit
            {
                for (i=0; i<CONST_t_pulse_burst/CONST_t_pulse_period; i++) // Put the burst part
                {
                    this.put_burst();
                }
                // Put the space part
                if (inverted_signal == false)
                {
                    ScanaStudio.builder_add_samples(ch_nec,0,this.sample_per_pulse_burst);
                }
                else
                {
                    ScanaStudio.builder_add_samples(ch_nec,1,this.sample_per_pulse_burst);
                }
            }
        }
        else // Normal Pulse
        {
            if (lvl == 1) // Put a high bit
            {
                // Put the pulse
                if (inverted_signal == false)
                {
                    ScanaStudio.builder_add_samples(ch_nec,1,this.sample_per_pulse_burst);
                }
                else
                {
                    ScanaStudio.builder_add_samples(ch_nec,0,this.sample_per_pulse_burst);
                }
                // Put the space part
                if (inverted_signal == false)
                {
                    ScanaStudio.builder_add_samples(ch_nec,0,this.sample_per_pulse_burst*3);
                }
                else
                {
                    ScanaStudio.builder_add_samples(ch_nec,1,this.sample_per_pulse_burst*3);
                }
            }
            else // Put a low bit
            {
                // Put the pulse
                if (inverted_signal == false)
                {
                    ScanaStudio.builder_add_samples(ch_nec,1,this.sample_per_pulse_burst);
                }
                else
                {
                    ScanaStudio.builder_add_samples(ch_nec,0,this.sample_per_pulse_burst);
                }
                // Put the space part
                if (inverted_signal == false)
                {
                    ScanaStudio.builder_add_samples(ch_nec,0,this.sample_per_pulse_burst);
                }
                else
                {
                    ScanaStudio.builder_add_samples(ch_nec,1,this.sample_per_pulse_burst);
                }
            }
        }
    },

    put_lead : function()
    {
        if (burst == true)
        {
            for (i=0; i<CONST_t_leading_pulse_burst/CONST_t_pulse_period; i++) // Put the burst part
            {
                this.put_burst();
            }
            // Put the space part
            if (inverted_signal == false)
            {
                ScanaStudio.builder_add_samples(ch_nec,0,this.samples_per_lead_space);
            }
            else
            {
                ScanaStudio.builder_add_samples(ch_nec,1,this.samples_per_lead_space);
            }
        }
        else
        {
            // Put the leading pulse
            if (inverted_signal == false)
            {
                ScanaStudio.builder_add_samples(ch_nec,1,this.samples_per_lead_pulse);
            }
            else
            {
                ScanaStudio.builder_add_samples(ch_nec,0,this.samples_per_lead_pulse);
            }
            // Put the space part
            if (inverted_signal == false)
            {
                ScanaStudio.builder_add_samples(ch_nec,0,this.samples_per_lead_space);
            }
            else
            {
                ScanaStudio.builder_add_samples(ch_nec,1,this.samples_per_lead_space);
            }
        }
    },

    put_adress : function(value)
    {
        var array = [];
        // Put the Adress
        for (n=0; n<8; n++)
        {
            this.put_bit(((value>>n)&0x1));
            array.push(((value>>n)&0x1));
        }
        // Put the complement
        for (n=0; n<8; n++)
        {
            if (array[i] == 1)
            {
                this.put_bit(0);
            }
            else
            {
                this.put_bit(1);
            }
        }
    },

    put_rand_adress : function()
    {
        var array = [];
        for (y = 0; y < 8; y++)
        {
            var lvl = Math.floor(Math.random()*2);
            this.put_bit(lvl);
            array.push(lvl);
        }
        // Put the complement
        var rng_2 = Math.floor(Math.random()*1.2);
        if (rng_2 == 1)
        {
            for (y = 0; y < 8; y++)
            {
                var lvl = Math.floor(Math.random()*2);
                this.put_bit(lvl);
            }
        }
        else
        {
            for (y=0; y<8; y++)
            {
                if (array[y] == 1)
                {
                    this.put_bit(0);
                }
                else
                {
                    this.put_bit(1);
                }
            }
        }
    },

    put_command : function(value)
    {
        var array = [];
        // Put the Adress
        for (y=0; y<8; y++)
        {
            this.put_bit(((value>>n)&0x1));
            array.push(((value>>n)&0x1));
        }
        // Put the complement
        for (y=0; y<8; y++)
        {
            if (array[y] == 1)
            {
                this.put_bit(0);
            }
            else
            {
                this.put_bit(1);
            }
        }
    },

    put_rand_command : function()
    {
        var array = [];
        for (y = 0; y < 8; y++)
        {
            var lvl = Math.floor(Math.random()*2);
            this.put_bit(lvl);
            array.push(lvl);
        }
        // Put the complement
        var rng_2 = Math.floor(Math.random()*1.2);
        if (rng_2 == 1)
        {
            for (y = 0; y < 8; y++)
            {
                var lvl = Math.floor(Math.random()*2);
                this.put_bit(lvl);
            }
        }
        else
        {
            for (y=0; y<8; y++)
            {
                if (array[y] == 1)
                {
                    this.put_bit(0);
                }
                else
                {
                    this.put_bit(1);
                }
            }
        }
    },

    put_end : function()
    {
        this.put_bit(0);
        this.put_silence(110-67.5);
    },

    put_repeat : function()
    {
        // Leading pulse + 2.25ms space
        if (burst == true)
        {
            for (i=0; i<CONST_t_leading_pulse_burst/CONST_t_pulse_period; i++) // Put the burst part
            {
                this.put_burst();
            }
            // Put the space part
            if (inverted_signal == false)
            {
                ScanaStudio.builder_add_samples(ch_nec,0,this.samples_per_repeat_space);
            }
            else
            {
                ScanaStudio.builder_add_samples(ch_nec,1,this.samples_per_repeat_space);
            }
        }
        else
        {
            // Put the leading pulse
            if (inverted_signal == false)
            {
                ScanaStudio.builder_add_samples(ch_nec,1,this.samples_per_lead_pulse);
            }
            else
            {
                ScanaStudio.builder_add_samples(ch_nec,0,this.samples_per_lead_pulse);
            }
            // Put the space part
            if (inverted_signal == false)
            {
                ScanaStudio.builder_add_samples(ch_nec,0,this.samples_per_repeat_space);
            }
            else
            {
                ScanaStudio.builder_add_samples(ch_nec,1,this.samples_per_repeat_space);
            }
        }
        // put 1 burst
        this.put_bit(0);
        this.put_silence(110-9-2.25-0.5625*2);
    },


    put_silence : function(ms)
    {
        if (inverted_signal == false)
        {
            ScanaStudio.builder_add_samples(ch_nec,0,ms*this.sample_per_second/1000);
        }
        else
        {
            ScanaStudio.builder_add_samples(ch_nec,1,ms*this.sample_per_second/1000);
        }
    },

    config : function(ch_nec, sample_rate, duty_cycle)
    {
        this.ch_nec = ch_nec;
        this.sample_per_second = sample_rate;
        this.samples_high_per_burst = CONST_t_pulse_period*duty_cycle*sample_rate;
        this.samples_low_per_burst = CONST_t_pulse_period*(1-duty_cycle)*sample_rate;
        this.samples_per_lead_pulse = CONST_t_leading_pulse_burst*sample_rate;
        this.samples_per_lead_space = CONST_t_leading_space*sample_rate;
        this.samples_per_repeat_space = CONST_t_repeat_space*sample_rate;
        this.sample_per_pulse_burst = CONST_t_pulse_burst*sample_rate;
    },

};//end BuilderObject

/*  A helper function add leading "0"s to numbers
      Parameters
        * num_str: A string of the number to be 0-padded
        * size: The total wanted size of the output string
*/
function pad(num_str, size)
{
    while (num_str.length < size)
    {
        num_str = "0" + num_str;
    }
    return num_str;
}

// Return decimal value of nbits bits array
function bin2dec (array)
{
  var dec = 0;
  for (i = 0; i < array.length; i++)
  {
    dec += array[i]*Math.pow(2,i);
  }
  return dec;
}
