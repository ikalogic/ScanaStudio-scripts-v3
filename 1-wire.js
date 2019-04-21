/* Protocol meta info:
<NAME> 1-Wire </NAME>
<DESCRIPTION>
1-Wire protocol analyzer. Decodes Reset, presence and byte fields.
</DESCRIPTION>
<VERSION> 0.0 </VERSION>
<AUTHOR_NAME> Ibrahim Kamal </AUTHOR_NAME>
<AUTHOR_URL> i.kamal@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright IKALOGIC SAS </COPYRIGHT>
<LICENSE>  This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.0:  Initial release.
</RELEASE_NOTES>
*/

/*
TODO: Add HEX display
TODO: Add trigger
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
  ScanaStudio.set_script_instance_name("1-Wire on CH "+(ScanaStudio.gui_get_value("ch")+1).toString());
  return "" //All good.
}

//Global variables
var sampling_rate;
var state_machine;

function on_decode_signals(resume)
{
  if (!resume) //If resume == false, it's the first call to this function.
  {
      //initialization code goes here, ex:
      state_machine = 0;
      sampling_rate = ScanaStudio.get_capture_sample_rate();
      ch = ScanaStudio.gui_get_value("ch");
      format = ScanaStudio.gui_get_value("format");
      suffix = "";
      switch (format) {
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
        default:
      }

      setup_1wire_parameters(sampling_rate,ScanaStudio.gui_get_value("speed"));

      ScanaStudio.trs_reset(ch); //reset the trs iterator.
      last_rising_edge = -1;
      last_falling_edge = -1;
      sample_points = []; //clear array
      byte_start = -1;
      bit_counter = 0;
      byte = 0;
      device_present = false;
  }

  while (ScanaStudio.abort_is_requested() == false)
  {
    if (!ScanaStudio.trs_is_not_last(ch))
    {
      break;
    }
    switch (state_machine)
    {
      case 0: //search for falling edge
        trs = ScanaStudio.trs_get_next(ch);
        if (trs.value == 0) //Falling edge found
        {
          last_falling_edge = trs.sample_index;
          state_machine++;
        }
        break;
      case 1: //Search for rising edge
        trs = ScanaStudio.trs_get_next(ch);
        if (trs.value == 1) //Rising edge found
        {
          last_rising_edge = trs.sample_index;
          state_machine ++;
        }
        //No break on purpose.
      case 2: //analyze the 1-Wire pulse
        if ((last_rising_edge - last_falling_edge) >= samples_per_reset_min) //Reset
        {
          bit_counter = 0;
          device_present = false;
          state_machine = 3;
          ScanaStudio.dec_item_new(ch,last_falling_edge,last_rising_edge);
          if (ScanaStudio.is_pre_decoding())
          {
            ScanaStudio.dec_item_add_content("R");
          }
          else
          {
            ScanaStudio.dec_item_emphasize_success();
            ScanaStudio.dec_item_add_content("Master reset pulse");
            ScanaStudio.dec_item_add_content("Reset pulse");
            ScanaStudio.dec_item_add_content("Reset");
            ScanaStudio.dec_item_add_content("R");
            ScanaStudio.dec_item_add_sample_point(last_falling_edge+samples_per_reset_min,"D");
          }
        }
        else if (device_present == true)
        {
          //ScanaStudio.console_info_msg("Analyzing falling edge",last_falling_edge);
          //ScanaStudio.console_info_msg("Analyzing rising edge",last_rising_edge);
          if ((last_rising_edge - last_falling_edge) > bit_sampling_point) //0
          {
            append_bit(0,last_falling_edge);
            state_machine = 0; //seek next bit
          }
          else
          {
            state_machine = 25;
          }
        }
        else
        {
          state_machine = 0;
          //Uknown pulse, expecting reset pulse
        }
        break;
      case 25: //search for next falling edge and add bit
        /*
        This state handles the case where the 1-Wire line may go high for a
        short period before (maybe) being pulled low by slave. This situation
        may produces short pulses that should be ignored.
        */
        trs = ScanaStudio.trs_get_next(ch);
        if (trs.value == 0) //Falling edge found
        {
          /*
          If next falling edge is before sampling point, we're still
          looking at the same bit. If, the falling edge comes after
          the sampling point, consider we're looking at a whole new bit.
          */
          //ScanaStudio.console_info_msg("Re-Analyzing falling edge",trs.sample_index);
          //ScanaStudio.console_info_msg("Previous falling edge",last_falling_edge);
          if ((trs.sample_index - last_falling_edge) > bit_sampling_point)
          {
            append_bit(1,last_falling_edge);
            //Advance the last_falling_edge variable
            last_falling_edge = trs.sample_index; //new bit
          }
          else
          {
            //keep the last_falling_edge variable unchanged,
            //to keep traking the first falling edge for that bit
          }

          state_machine = 1; //Continue decoding
        }
        break;
      case 3: //Check presence
        trs = ScanaStudio.trs_get_next(ch);
        if (trs.value == 0)
        {
          //If slave device pulls bus low before sampling point
          if ((trs.sample_index - last_rising_edge) <= presence_sampling_point)
          {
            last_falling_edge = trs.sample_index;
            state_machine++;
          }
          else
          {
            ScanaStudio.dec_item_new(ch,last_rising_edge+presence_sampling_point*0.1,last_rising_edge+presence_sampling_point*1.1);
            ScanaStudio.dec_item_add_sample_point(last_rising_edge+presence_sampling_point,"X");
            ScanaStudio.dec_item_add_content("No Presence pulse!");
            ScanaStudio.dec_item_add_content("No Presence!");
            ScanaStudio.dec_item_add_content("P!");
            ScanaStudio.dec_item_add_content("!");
            ScanaStudio.dec_item_emphasize_warning();
            last_falling_edge = trs.sample_index;
            state_machine = 1;
          }
        }
      break;
      case 4: //search end of presence pulse
        trs = ScanaStudio.trs_get_next(ch);
        if (trs.value == 1)
        {
          last_rising_edge = trs.sample_index;
          device_present = true;
          state_machine = 0;
          ScanaStudio.dec_item_new(ch,last_falling_edge,last_rising_edge);
          if (ScanaStudio.is_pre_decoding())
          {
            ScanaStudio.dec_item_add_content("P");
          }
          else
          {
            ScanaStudio.dec_item_add_content("Presence pulse");
            ScanaStudio.dec_item_add_content("Presence");
            ScanaStudio.dec_item_add_content("P");
            ScanaStudio.dec_item_add_sample_point(last_falling_edge+presence_sampling_point,"D");
          }
        }
      default:
        //Todo...
    }
  }
}

function append_bit(b,falling_edge)
{
  byte |= (b << bit_counter);
  sample_points.push(falling_edge+bit_sampling_point);

  if (bit_counter == 0)
  {
    byte_start = falling_edge;
  }

  bit_counter++;

  if (bit_counter == 8)
  {
    ScanaStudio.dec_item_new(ch,byte_start,falling_edge+(bit_sampling_point*1.25));
    ScanaStudio.dec_item_add_content(suffix+byte.toString(format));
    var s = 0;
    for (s = 0; s < sample_points.length; s++)
    {
      ScanaStudio.dec_item_add_sample_point(sample_points[s],(byte >> s) & 0x1);
    }
    bit_counter = 0;
    byte = 0;
    sample_points = []; //clear array
  }
}

//Function called to generate demo siganls (when no physical device is attached)
function on_build_demo_signals()
{
  //Use the function below to get the number of samples to be built
  var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
  var sampling_rate = ScanaStudio.builder_get_sample_rate();
  var builder = ScanaStudio.BuilderObject;
  var ch = ScanaStudio.gui_get_value("ch");
  var speed = ScanaStudio.gui_get_value("speed");
  setup_1wire_parameters(sampling_rate,speed);
  var silence_period = (samples_to_build - (samples_per_bit*1500))/10;
  if (silence_period < (10e-6 * sampling_rate)) silence_period = 10e-6 * sampling_rate;
  builder.config(ch,speed);
  builder.put_silence(10e-6 * sampling_rate);
  while (ScanaStudio.builder_get_samples_acc(ch) < samples_to_build)
  {
    builder.put_reset();
    builder.put_presence(0);
    var random_size = Math.floor(Math.random()*10) + 1;
    var w;
    for (w = 0; w < random_size; w++)
    {
      random_data = Math.round(Math.random()*256);
      builder.put_byte(random_data);
    }
    builder.put_silence(silence_period);
    /*builder.put_byte(0x55);
    builder.put_byte(0xAA);
    builder.put_byte(0xA1);
    builder.put_byte(0xA2);*/
  }
}

//Helper function used to calculate the key parameters of 1-Wire waveforms
function setup_1wire_parameters(sampling_rate,speed)
{
  //See: https://www.maximintegrated.com/en/app-notes/index.mvp/id/126
  us = 1e-6 * sampling_rate;
  if (speed == 0) //Standard speed
  {
    sync_bit = 6 * us;
    samples_per_bit = 70 * us;  //Measured from master falling edge
    bit_sampling_point = (15) * us; //Measured from master falling edge
    samples_per_reset_min = 480 * us;
    presence_sampling_point = (70) * us; //measured after end of reset
  }
  else
  {
    sync_bit = 1 * us;
    samples_per_bit = 8.5 * us;  //Measured from master falling edge
    bit_sampling_point = (2) * us; //Measured from master falling edge
    samples_per_reset_min = 70 * us;
    presence_sampling_point = (8.5) * us; //measured after end of reset
  }
}

//Builder object that can be shared to other scripts
ScanaStudio.BuilderObject = {
  put_silence : function(samples)
  {
    ScanaStudio.builder_add_samples(this.channel,1,samples);
  },
  put_byte : function(byte)
  {
    var b = 0;
    for (b = 0; b < 8; b++)
    {
      this.put_bit((byte >> b)&0x1);
    }
  },
  put_bit : function(b)
  {
    ScanaStudio.builder_add_samples(this.channel,0,sync_bit);
    ScanaStudio.builder_add_samples(this.channel,1,sync_bit*0.1);
    ScanaStudio.builder_add_samples(this.channel,b,bit_sampling_point);
    ScanaStudio.builder_add_samples(this.channel,1,sync_bit*0.1);
  },
  put_reset : function()
  {
    ScanaStudio.builder_add_samples(this.channel,0,samples_per_reset_min*1.1);
    ScanaStudio.builder_add_samples(this.channel,1,presence_sampling_point*0.25);
  },
  put_presence : function(presence_bit)
  {
    ScanaStudio.builder_add_samples(this.channel,presence_bit,presence_sampling_point*1.1);
    ScanaStudio.builder_add_samples(this.channel,1,presence_sampling_point*0.25);
  },
  config : function(ch,speed)
  {
    this.channel = ch;
  }
};
