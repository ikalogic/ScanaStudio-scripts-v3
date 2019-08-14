/* Protocol meta info:
<NAME> Frequency decoder </NAME>
<DESCRIPTION>
Analyze logic signals to shows its frequency. This script's main aim
is to provide a simple example to be inspired from when creating a
new decoder.
</DESCRIPTION>
<VERSION> 0.2 </VERSION>
<AUTHOR_NAME>  Ibrahim KAMAL </AUTHOR_NAME>
<AUTHOR_URL> i.kamal@ikalogic.com </AUTHOR_URL>
<COPYRIGHT> Copyright Ibrahim KAMAL </COPYRIGHT>
<LICENSE>  This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.2: Added dec_item_end() for each dec_item_new().
V0.1: Initial release.
</RELEASE_NOTES>
*/


//Decoder GUI
function on_draw_gui_decoder()
{
  ScanaStudio.gui_add_ch_selector("freq_ch","Channel to analyze","");
}

//Global variables
var sampling_rate;
var state_machine;
var freq_ch;
var trs; //transition iterator
var last_rising_edge;
var last_falling_edge;

function on_decode_signals(resume)
{
  var period,frequency;
  if (!resume) //If resume == false, it's the first call to this function.
  {
      //initialization code goes here, ex:
      ScanaStudio.console_info_msg("Frequency analyzer initialized");
      state_machine = 0;
      sampling_rate = ScanaStudio.get_capture_sample_rate();
      freq_ch = ScanaStudio.gui_get_value("freq_ch");
      ScanaStudio.trs_reset(freq_ch); //reset the trs iterator.
      last_rising_edge = -1;
      last_falling_edge = -1;
  }


  while (ScanaStudio.abort_is_requested() == false)
  {
    if (!ScanaStudio.trs_is_not_last(freq_ch))
    {
      break;
    }
    switch (state_machine)
    {
      case 0: //search for rising edge
        trs = ScanaStudio.trs_get_next(freq_ch); //fetch next transition
        if (trs.value == 1) //Rising edge found?
        {
          if (last_rising_edge != -1) //if it's not the very first rising edge
          {
            period = (trs.sample_index - last_rising_edge) / sampling_rate; //period in [s]
            frequency = 1/period; //in [Hz]

            ScanaStudio.dec_item_new(freq_ch,last_rising_edge,trs.sample_index);
            ScanaStudio.dec_item_add_content("Frequency = " + ScanaStudio.engineering_notation(frequency,5) + "Hz");
            ScanaStudio.dec_item_add_content("Frequency = " + ScanaStudio.engineering_notation(frequency,4) + "Hz");
            ScanaStudio.dec_item_add_content("Freq. = " + ScanaStudio.engineering_notation(frequency,3)     + "Hz");
            ScanaStudio.dec_item_add_content("F = " + ScanaStudio.engineering_notation(frequency,3)         + "Hz");
            ScanaStudio.dec_item_add_content(ScanaStudio.engineering_notation(frequency,3)                  + "Hz");
            ScanaStudio.dec_item_add_content(ScanaStudio.engineering_notation(frequency,3));
            ScanaStudio.dec_item_end();

            //Add byte to hex view
            if (frequency > 255e3)
            {
                ScanaStudio.hex_view_add_byte(freq_ch,last_rising_edge,trs.sample_index,0xFF);
            }
            else
            {
                ScanaStudio.hex_view_add_byte(freq_ch,last_rising_edge,trs.sample_index,frequency/1000);
            }

            //Add new packet packet view
            ScanaStudio.packet_view_add_packet(true,freq_ch,last_rising_edge,trs.sample_index,"Frequency",ScanaStudio.engineering_notation(frequency,5) + "Hz","#00FFFF","content_bg_html_color");
          }
          last_rising_edge = trs.sample_index;
          state_machine++;
        }
        break;
      case 1: //search for falling edge
        trs = ScanaStudio.trs_get_next(freq_ch); //fetch next transition
        if (trs.value == 0) //Falling edge found?
        {
          last_falling_edge = trs.sample_index;
          state_machine = 0;
        }
        break;
      default:
        state_machine = 0;
    }
  }
}



//Trigger sequence GUI
function on_draw_gui_trigger()
{
  ScanaStudio.gui_add_info_label("Please select a trigger alternative and conigure it.\n" +
                                 "Frequency should be written without units, ex: \"1.5e6\" for 1.5 MHz");
  ScanaStudio.gui_add_new_tab("freq_bigger_than","Frequency above threshold",true);
    ScanaStudio.gui_add_info_label("Trigger will occure when the frequency is above the threshold");
    ScanaStudio.gui_add_text_input("f_big","Frequency","1e3");
  ScanaStudio.gui_end_tab();
  ScanaStudio.gui_add_new_tab("freq_smaller_than","Frequency below threshold",false);
    ScanaStudio.gui_add_info_label("Trigger will occure when the frequency is below the threshold");
    ScanaStudio.gui_add_text_input("f_small","Frequency","1e3");
  ScanaStudio.gui_end_tab();
  ScanaStudio.gui_add_new_tab("freq_between","Frequency between two values",false);
    ScanaStudio.gui_add_info_label("Trigger will occure when the frequency is between two values");
    ScanaStudio.gui_add_text_input("f_v1","First frequency","1e3");
    ScanaStudio.gui_add_text_input("f_v2","Second frequency","1e3");
  ScanaStudio.gui_end_tab();
}

function on_build_trigger()
{
  var freq_ch = ScanaStudio.gui_get_value("freq_ch");
  var freq_bigger_than = ScanaStudio.gui_get_value("freq_bigger_than");

  ScanaStudio.console_info_msg("build trigger called, freq_ch = " + freq_ch + " freq_bigger_than = " + freq_bigger_than);
  ScanaStudio.flexitrig_append(build_trigger_step_string(freq_ch),-1,-1);
  ScanaStudio.flexitrig_append(build_trigger_step_string(freq_ch),1e-3,5e-3);
  ScanaStudio.flexitrig_print_steps();
}

function build_trigger_step_string(channel)
{
  var i;
  var ret = "";
  for (i = 0; i < channel; i++)
  {
    if (i == channel)
    {
      ret += "R";
    }
    else {
      ret += "X";
    }
  }
}

//Function called to generate demo siganls (when no physical device is attached)
function on_build_demo_signals()
{
  //Use the function below to get the number of samples to be built
  var freq_ch = ScanaStudio.gui_get_value("freq_ch");
  var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
  var sample_rate = ScanaStudio.builder_get_sample_rate();

  //create and configure a builder object
  var pwm_builder = ScanaStudio.BuilderObject;
  pwm_builder.set_channel(freq_ch);
  pwm_builder.set_frequency(100e3);
  pwm_builder.set_sample_rate(ScanaStudio.builder_get_sample_rate());

  //Build saw tooth PWM signal
  var duty_cycle = 0;
  ScanaStudio.report_progress(0);
  while (ScanaStudio.builder_get_samples_acc(freq_ch) < samples_to_build)
  {
    duty_cycle += 0.05;
    if (duty_cycle > 0.95)
    {
      duty_cycle = 0.05;
    }
    pwm_builder.build_cycle(duty_cycle);
    ScanaStudio.report_progress(ScanaStudio.builder_get_samples_acc(freq_ch) * 100 / samples_to_build);
  }
}

//Builder object that can be shared to other scripts
ScanaStudio.BuilderObject = {
  channel: 0, //To be configured by whoever uses the builder
  frequency: 10e3,
  sampling_rate: 1e6, //to be configured by the user of this object
	build_cycle : function(duty_cycle)
  {
    var sr = (this.sampling_rate*1.0);
    var f = (this.frequency*1.0);
    var samples_count = (this.sampling_rate*1.0)/(this.frequency*1.0);
    var samples_count = sr/f;
		ScanaStudio.builder_add_cycles(this.channel,duty_cycle,samples_count,1);
  },
  set_channel : function(ch)
  {
    this.channel = ch;
  },
  set_frequency : function(f)
  {
    this.frequency = f;
  },
  set_sample_rate : function(sr)
  {
    this.sampling_rate = sr;
  }
};
