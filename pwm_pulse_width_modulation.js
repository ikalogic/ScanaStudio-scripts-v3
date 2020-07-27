/* Protocol meta info:
<NAME> PWM </NAME>
<DESCRIPTION>
PWM (Pulse Width Modulation) module. Can be used to decode and generate PWM signals.
</DESCRIPTION>
<VERSION> 0.3 </VERSION>
<AUTHOR_NAME>  Ibrahim KAMAL </AUTHOR_NAME>
<AUTHOR_URL> i.kamal@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright Ibrahim KAMAL </COPYRIGHT>
<LICENSE>  This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
v0.3: Added phase shift option for fixed duty cycle generator.
V0.2: Added dec_item_end() for each dec_item_new().
V0.1: Initial release.
</RELEASE_NOTES>
*/

//Decoder GUI
function on_draw_gui_decoder()
{
  //Define decoder configuration GUI
  ScanaStudio.gui_add_ch_selector("pwm_ch","PWM channel","PWM");
}

//Evaluate decoder GUI
function on_eval_gui_decoder()
{
  ScanaStudio.set_script_instance_name("PWM on CH "+ (ScanaStudio.gui_get_value("pwm_ch")+1).toString());
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
      pwm_ch = ScanaStudio.gui_get_value("pwm_ch");
      ScanaStudio.trs_reset(pwm_ch); //reset the trs iterator.
      last_rising_edge = -1;
      last_falling_edge = -1;
  }

  while (ScanaStudio.abort_is_requested() == false)
  {
    if (!ScanaStudio.trs_is_not_last(pwm_ch))
    {
      break;
    }
    switch (state_machine)
    {
      case 0: //search for rising edge
        trs = ScanaStudio.trs_get_next(pwm_ch); //fetch next transition
        if (trs.value == 1) //Rising edge found?
        {
          if (last_rising_edge != -1) //if it's not the very first rising edge
          {
            period = (trs.sample_index - last_rising_edge) / sampling_rate; //period in [s]
            period_on = (last_falling_edge - last_rising_edge) / sampling_rate; // [s]
            duty = period_on * 100 / period;
            frequency = 1/period; //in [Hz]
            ScanaStudio.dec_item_new(pwm_ch,last_rising_edge,trs.sample_index);
            ScanaStudio.dec_item_add_content("Duty cycle = " + ScanaStudio.engineering_notation(duty,4) + "%");
            ScanaStudio.dec_item_add_content("Duty = " + ScanaStudio.engineering_notation(duty,4) + "%");
            ScanaStudio.dec_item_add_content("Duty = " + ScanaStudio.engineering_notation(duty,4) + "%");
            ScanaStudio.dec_item_add_content("Duty = " + ScanaStudio.engineering_notation(duty,3) + "%");
            ScanaStudio.dec_item_add_content("D = " + ScanaStudio.engineering_notation(duty,3)    + "%");
            ScanaStudio.dec_item_add_content(ScanaStudio.engineering_notation(duty,3)             + "%");
            ScanaStudio.dec_item_add_content(Math.round(duty).toString());
            ScanaStudio.dec_item_end();
          }
          last_rising_edge = trs.sample_index;
          state_machine++;
        }
        break;
      case 1: //search for falling edge
        trs = ScanaStudio.trs_get_next(pwm_ch); //fetch next transition
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


//Function called to generate demo siganls (when no physical device is attached)
function on_build_demo_signals()
{
  //Use the function below to get the number of samples to be built
  var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
  var sampling_rate = ScanaStudio.builder_get_sample_rate();
  var mod_f = sampling_rate/(samples_to_build/100);
  if (mod_f < 1) mod_f = 1;
  var car_f = mod_f * 100;
  var pwm_builder = ScanaStudio.BuilderObject;
  pwm_builder.configure_sine(
    ScanaStudio.gui_get_value("pwm_ch"), //channel
    mod_f, //modulation_freq
    0, //modulation_phase
    car_f, //carrier_f
    0.1,//duty_min
    0.9); //duty_max

  ScanaStudio.builder_add_samples(1,1,samples_to_build);

  while (ScanaStudio.builder_get_samples_acc(0) < samples_to_build)
  {
    pwm_builder.build_cycle_sine();
    ScanaStudio.report_progress(ScanaStudio.builder_get_samples_acc(0) * 100 / samples_to_build);
    if (ScanaStudio.abort_is_requested())
    {
      break;
    }
  }
}

//Signal builder GUI
function on_draw_gui_signal_builder()
{
  var max_car_f = ScanaStudio.builder_get_sample_rate()/10; //at least 10 samples per period
  var max_mod_f = max_car_f/10; //At least 5 carrier periods per modulations period
  var min_mod_f = 2 * ScanaStudio.builder_get_sample_rate()
                  / ScanaStudio.builder_get_maximum_samples_count(); //at least 2 full periods
  var def_mod_f = Math.round((max_mod_f + min_mod_f) / 2);
  var def_car_f = (max_car_f + def_mod_f) / 2;
  if (min_mod_f >= max_mod_f)
  {
    ScanaStudio.gui_add_info_label("GUI ERROR: Sampling rate is too low");
    ScanaStudio.console_error_msg("GUI ERROR: Sampling rate is too low");
    return;
  }
  //Define decoder configuration GUI
  ScanaStudio.gui_add_ch_selector("channel","Target channel","PWM");

  ScanaStudio.gui_add_new_selectable_containers_group("gen_type_group","Please select type of signals");
    ScanaStudio.gui_add_new_container("Fixed duty cycle",true);
      ScanaStudio.gui_add_engineering_form_input_box("simple_freq_val","Frequency",min_mod_f,max_car_f,def_car_f,"Hz");
      ScanaStudio.gui_add_info_label("Minimum: " + ScanaStudio.engineering_notation(min_mod_f,3) + "Hz\n"
                                      +"Maximum: " + ScanaStudio.engineering_notation(max_car_f,3) + "Hz"
                                      );
      ScanaStudio.gui_add_engineering_form_input_box("simple_pwm_val","Duty cycle",0,100,50,"%");
      ScanaStudio.gui_add_engineering_form_input_box("car_phase","Phase shift",0,360,0,"Deg");
    ScanaStudio.gui_end_container();
    ScanaStudio.gui_add_new_container("Modulated frequency",false);
      ScanaStudio.gui_add_combo_box("mod_type","Modulation type");
        ScanaStudio.gui_add_item_to_combo_box("Sine",true);
        ScanaStudio.gui_add_item_to_combo_box("Triangle",false);
        ScanaStudio.gui_add_item_to_combo_box("SawTooth",false);
      ScanaStudio.gui_add_engineering_form_input_box("f_mod","Modulation frequency",min_mod_f,max_mod_f,def_mod_f,"Hz");
      ScanaStudio.gui_add_engineering_form_input_box("ph_mod","Modulation phase",0,360,"0","DEG(°)");
      ScanaStudio.gui_add_engineering_form_input_box("freq_carrier","Carrier frequency",min_mod_f,max_car_f,def_car_f,"Hz");
      ScanaStudio.gui_add_engineering_form_input_box("duty_min","Carrier minimum (lower) frequency",0,100,10,"%");
      ScanaStudio.gui_add_engineering_form_input_box("duty_max","Carrier minimum (lower) frequency",0,100,90,"%");
      ScanaStudio.gui_add_info_label("Modulation frequency range:" + ScanaStudio.engineering_notation(min_mod_f,3) + "Hz to "
                                    + ScanaStudio.engineering_notation(max_mod_f,3) + "Hz\n"
                                    +"Max. carrier frequency:" + ScanaStudio.engineering_notation(min_mod_f,3) + "Hz\n"
                                    + "Min. carrier frequency must be higher than modulation frequency."
                                    );
    ScanaStudio.gui_end_container();
  ScanaStudio.gui_end_selectable_containers_group();
}

//Evaluate signal builder GUI
function on_eval_gui_signal_builder()
{
  ScanaStudio.set_script_instance_name("PWM Builder on CH "+ (ScanaStudio.gui_get_value("channel")+1).toString());
  return "" //All good.
}

//Function called to build siganls (to be generate by capable device)
function on_build_signals()
{
  //Use the function below to get the number of samples to be built
  var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
  var pwm_builder = ScanaStudio.BuilderObject;
  gen_type_group = ScanaStudio.gui_get_value("gen_type_group");
  channel = ScanaStudio.gui_get_value("channel");
  mod_type = ScanaStudio.gui_get_value("mod_type");
  if (gen_type_group == 0) //Simple fixed frequency & fixed pwm.
  {
    //Here we use the SawTooth modulator with a fixed duty cycle
    //to achieve simple fixed frequency signal building
    pwm_builder.configure_sawtooth(
      channel, //channel
      ScanaStudio.gui_get_value("simple_freq_val"), //modulation_freq
      0, //modulation_phase
      ScanaStudio.gui_get_value("simple_freq_val"), //carrier_f
      ScanaStudio.gui_get_value("simple_pwm_val")/100,//duty_min
      ScanaStudio.gui_get_value("simple_pwm_val")/100,//duty_max
      ScanaStudio.gui_get_value("car_phase")
    );
  }
  else if (mod_type == 0) //Sine
  {
    pwm_builder.configure_sine(
      channel, //channel
      ScanaStudio.gui_get_value("f_mod"), //modulation_freq
      ScanaStudio.gui_get_value("ph_mod"), //modulation_phase
      ScanaStudio.gui_get_value("freq_carrier"), //carrier_f
      ScanaStudio.gui_get_value("duty_min")/100,//duty_min
      ScanaStudio.gui_get_value("duty_max")/100 //duty_max
    );
  }
  else if (mod_type == 1) //Triangle
  {
    pwm_builder.configure_triangle(
      channel, //channel
      ScanaStudio.gui_get_value("f_mod"), //modulation_freq
      ScanaStudio.gui_get_value("ph_mod"), //modulation_phase
      ScanaStudio.gui_get_value("freq_carrier"), //carrier_f
      ScanaStudio.gui_get_value("duty_min")/100,//duty_min
      ScanaStudio.gui_get_value("duty_max")/100 //duty_max
    );
  }
  else if (mod_type == 2) //SawTooth
  {
    pwm_builder.configure_sawtooth(
      channel, //channel
      ScanaStudio.gui_get_value("f_mod"), //modulation_freq
      ScanaStudio.gui_get_value("ph_mod"), //modulation_phase
      ScanaStudio.gui_get_value("freq_carrier"), //carrier_f
      ScanaStudio.gui_get_value("duty_min")/100,//duty_min
      ScanaStudio.gui_get_value("duty_max")/100 //duty_max
    );
  }

  while ((ScanaStudio.builder_get_samples_acc(channel) < samples_to_build)
        && (ScanaStudio.abort_is_requested() == false) )
  {
    if (gen_type_group == 0)
    {
      pwm_builder.build_cycle_sawtooth();
    }
    else if (mod_type == 0) //Sine
    {
      pwm_builder.build_cycle_sine();
    }
    else if (mod_type == 1) //Triangle
    {
      pwm_builder.build_cycle_triangle();
    }
    else if (mod_type == 2) //SawTooth
    {
      pwm_builder.build_cycle_sawtooth();
    }

    ScanaStudio.report_progress(ScanaStudio.builder_get_samples_acc(0) * 100 / samples_to_build);
  }
}

//Builder object that can be shared to other scripts
ScanaStudio.BuilderObject = {
	build_cycle_sine : function()
  {
    if (this.modulation != "sine")
    {
      if (this.modulation.length > 0)
      {
          ScanaStudio.console_error_msg("Please run configure_sine() function before using build_cycle_sine()");
          this.modulation = ""; //don't display this message more than once
          return;
      }
    }
    if (this.samples_acc_per_mod_period > this.samples_per_mod_period)
    {
      this.samples_acc_per_mod_period -= this.samples_per_mod_period;
    }
    var a = ((2*Math.PI)*this.samples_acc_per_mod_period / this.samples_per_mod_period) + this.modulation_phase;
    var duty = this.duty_min + 0.5*((Math.sin(a)+1) * (this.duty_max - this.duty_min));
    this.samples_acc_per_mod_period+= this.samples_per_cycle;
		ScanaStudio.builder_add_cycles(this.channel,duty,this.samples_per_cycle,1);
  },
  build_cycle_triangle : function()
  {
    if (this.modulation != "triangle")
    {
      if (this.modulation.length > 0)
      {
          ScanaStudio.console_error_msg("Please run configure_triangle() function before using build_cycle_triangle()");
          this.modulation = ""; //don't display this message more than once
          return;
      }
    }
    if (this.samples_acc_per_mod_period > this.samples_per_mod_period)
    {
      this.samples_acc_per_mod_period -= this.samples_per_mod_period;
    }
    var amp = this.duty_max - this.duty_min;
    var quarter_period = this.samples_per_mod_period / 2;
    var duty = ((amp/quarter_period) * (quarter_period - Math.abs((this.samples_acc_per_mod_period % (2*quarter_period)) - quarter_period))) + this.duty_min;
    this.samples_acc_per_mod_period+= this.samples_per_cycle;
		ScanaStudio.builder_add_cycles(this.channel,duty,this.samples_per_cycle,1);
  },
  build_cycle_sawtooth : function()
  {
    if (this.modulation != "sawtooth")
    {
      if (this.modulation.length > 0)
      {
          ScanaStudio.console_error_msg("Please run configure_sawtooth() function before using build_cycle_sawtooth()");
          this.modulation = ""; //don't display this message more than once
          return;
      }
    }
    if (this.samples_acc_per_mod_period > this.samples_per_mod_period)
    {
      this.samples_acc_per_mod_period -= this.samples_per_mod_period;
    }
    var amp = this.duty_max - this.duty_min;

    this.samples_acc_per_mod_period+= this.samples_per_cycle;
    var duty = this.duty_min + (amp * this.samples_acc_per_mod_period/this.samples_per_mod_period);
		ScanaStudio.builder_add_cycles(this.channel,duty,this.samples_per_cycle,1);
  },
  configure_sine : function(channel,modulation_freq,modulation_phase,carrier_f,duty_min,duty_max)
  {
    this.modulation = "sine";
    this.channel = channel;
    this.modulation_phase = modulation_phase*Math.PI/180;
    this.carrier_frequency = carrier_f;
    this.duty_min = duty_min;
    this.duty_max = duty_max;

    //Calculate working variable
    this.sample_rate = ScanaStudio.builder_get_sample_rate();
    this.samples_per_mod_period = this.sample_rate / modulation_freq;
    this.samples_per_cycle = (this.sample_rate) / this.carrier_frequency;
    this.duty_increment_per_cycle = this.samples_per_cycle / (this.samples_per_mod_period);
    this.samples_per_mod_period = this.sample_rate / modulation_freq;
    this.samples_acc_per_mod_period = 0;
  },
  configure_triangle : function(channel,modulation_freq,modulation_phase,carrier_f,duty_min,duty_max)
  {
    this.modulation = "triangle";
    this.channel = channel;
    this.modulation_phase = modulation_phase*Math.PI/180;
    this.carrier_frequency = carrier_f;
    this.duty_min = duty_min;
    this.duty_max = duty_max;

    //Calculate working variable
    this.sample_rate = ScanaStudio.builder_get_sample_rate();
    this.samples_per_mod_period = this.sample_rate / modulation_freq;
    this.samples_per_cycle = (this.sample_rate) / this.carrier_frequency;
    this.duty_increment_per_cycle = this.samples_per_cycle / (this.samples_per_mod_period);
    this.samples_acc_per_mod_period = (modulation_phase/(2*Math.PI))*(this.samples_per_mod_period);
  },
  configure_sawtooth : function(channel,modulation_freq,modulation_phase,carrier_f,duty_min,duty_max,carrier_phase)
  {
    this.modulation = "sawtooth";
    this.channel = channel;
    this.modulation_phase = modulation_phase*Math.PI/180;
    this.carrier_frequency = carrier_f;
    this.duty_min = duty_min;
    this.duty_max = duty_max;

    //Calculate working variable
    this.sample_rate = ScanaStudio.builder_get_sample_rate();
    this.samples_per_mod_period = this.sample_rate / modulation_freq;
    this.samples_per_cycle = (this.sample_rate) / this.carrier_frequency;
    this.duty_increment_per_cycle = this.samples_per_cycle / (this.samples_per_mod_period);
    this.samples_acc_per_mod_period = (modulation_phase/(2*Math.PI))*(this.samples_per_mod_period);

    //Do the carrier phase shift
    if ((carrier_phase == 0) || (carrier_phase === undefined))
    {
    }
    else if (carrier_phase <= 180)
    {
        ScanaStudio.builder_add_samples(channel,0,this.samples_per_cycle*carrier_phase/360);
        //ScanaStudio.builder_add_samples(channel,1,this.samples_per_cycle*0.25);
    }
    else
    {
        ScanaStudio.builder_add_samples(channel,1,
            (this.samples_per_cycle*carrier_phase/360) - (this.samples_per_cycle*0.5)
        );
        ScanaStudio.builder_add_samples(channel,0,this.samples_per_cycle*0.5);
    }
  }
};
