/* Protocol meta info:
<NAME> Frequency modulation </NAME>
<DESCRIPTION>
Frequency modulation logic signal generator
</DESCRIPTION>
<VERSION> 0.1 </VERSION>
<AUTHOR_NAME>  Ibrahim KAMAL </AUTHOR_NAME>
<AUTHOR_URL> https://wwww.ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki/Frequency-modulation-script-documentation </HELP_URL>
<COPYRIGHT> Copyright IKALOGIC SAS </COPYRIGHT>
<LICENSE>  This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.1:  Initial release.
</RELEASE_NOTES>
*/

/*
  todo
  ~~~~
  * Use selectable group instead of tabs
  * impelement square modulation
  * Update online github documentation
*/

//Global variables
var sampling_rate;
var state_machine;

//Signal builder GUI
function on_draw_gui_signal_builder()
{
  var max_car_f = ScanaStudio.builder_get_sample_rate()/10; //at least 10 samples per period
  var max_mod_f = max_car_f/5; //At least 5 carrier periods per modulations period
  var min_mod_f = 2 * ScanaStudio.builder_get_sample_rate()
                  / ScanaStudio.builder_get_maximum_samples_count(); //at least 2 full periods
  var def_mod_f = (max_mod_f + min_mod_f) / 2;
  var def_car_f = (max_car_f + def_mod_f) / 2;
  // ScanaStudio.console_info_msg("max_mod_f="+ ScanaStudio.engineering_notation(max_mod_f,3)+"Hz");
  // ScanaStudio.console_info_msg("min_mod_f="+ ScanaStudio.engineering_notation(min_mod_f,3)+"Hz");
  // ScanaStudio.console_info_msg("max_car_f="+ ScanaStudio.engineering_notation(max_car_f,3)+"Hz");
  if (min_mod_f >= max_mod_f)
  {
    ScanaStudio.console_error_msg("GUI ERROR: Sampling rate is too low");
    return;
  }
  ScanaStudio.get_device_n
  //Define decoder configuration GUI
  ScanaStudio.gui_add_ch_selector("channel","Target channel","FM");

  ScanaStudio.gui_add_new_selectable_containers_group("gen_type_group","Please select type of signals");
    ScanaStudio.gui_add_new_container("Fixed frequency",true);
      ScanaStudio.gui_add_engineering_form_input_box("simple_freq_val","Frequency",min_mod_f,max_car_f,def_car_f,"Hz");
      ScanaStudio.gui_add_info_label("Minimum: " + ScanaStudio.engineering_notation(min_mod_f,3) + "Hz\n"
                                      +"Maximum: " + ScanaStudio.engineering_notation(max_car_f,3) + "Hz"
                                      );
    ScanaStudio.gui_end_container();
    ScanaStudio.gui_add_new_container("Modulated frequency",false);
      ScanaStudio.gui_add_combo_box("mod_type","Modulation type");
        ScanaStudio.gui_add_item_to_combo_box("Sine",true);
        ScanaStudio.gui_add_item_to_combo_box("Triangle",false);
        ScanaStudio.gui_add_item_to_combo_box("SawTooth",false);
        //ScanaStudio.gui_add_item_to_combo_box("Square",false); //TODO
        //ScanaStudio.gui_add_item_to_combo_box("BFSK",false);  //TODO
      ScanaStudio.gui_add_engineering_form_input_box("f_mod","Modulation frequency",min_mod_f,max_mod_f,def_mod_f,"Hz");
      ScanaStudio.gui_add_engineering_form_input_box("ph_mod","Modulation phase",0,360,"0","DEG(°)");
      ScanaStudio.gui_add_engineering_form_input_box("f_car_min","Carrier minimum (lower) frequency",min_mod_f,max_car_f,max_mod_f,"Hz");
      ScanaStudio.gui_add_engineering_form_input_box("f_car_max","Carrier minimum (lower) frequency",min_mod_f,max_car_f,max_car_f,"Hz");
      ScanaStudio.gui_add_info_label("Modulation frequency range:" + ScanaStudio.engineering_notation(min_mod_f,3) + "Hz to "
                                    + ScanaStudio.engineering_notation(max_mod_f,3) + "Hz\n"
                                    +"Max. carrier frequency:" + ScanaStudio.engineering_notation(min_mod_f,3) + "Hz\n"
                                    + "Min. carrier frequency must be higher than modulation frequency."
                                    );
    ScanaStudio.gui_end_container();
  ScanaStudio.gui_end_selectable_containers_group();



  //Add other gui functions...
}

//Function called to generate demo siganls (when no physical device is attached)
function on_build_demo_signals()
{
  //Use the function below to get the number of samples to be built
  var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
  ScanaStudio.console_info_msg("samples_to_build="+samples_to_build);
  var fm_builder = ScanaStudio.BuilderObject;
  fm_builder.configure_triangle(0,1e3,Math.PI/2,100e3,100e4);
  //Todo: build the demo signals
  while (ScanaStudio.builder_get_samples_acc(0) < samples_to_build)
  {
    fm_builder.build_cycle_triangle();
    ScanaStudio.report_progress(ScanaStudio.builder_get_samples_acc(0) * 100 / samples_to_build);
  }
}

//Function called to build siganls (to be generate by capable device)
function on_build_signals()
{
  //Todo: build the signals

  //Use the function below to get the number of samples to be built
  var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
  var fm_builder = ScanaStudio.BuilderObject;
  gen_type_group = ScanaStudio.gui_get_value("gen_type_group");
  ScanaStudio.console_info_msg("on_build_signals() called. gen_type_group="+gen_type_group);
  channel = ScanaStudio.gui_get_value("channel");
  mod_type = ScanaStudio.gui_get_value("mod_type");
  if (gen_type_group == 0) //Simple fixed frequency.
  {
    //Here we use the sine modulator with a fixed carrier frequency
    //to achieve simple fixed frequency signal building
    fm_builder.configure_sine(
      channel,
      1, 0, //no modulation anyway
      ScanaStudio.gui_get_value("simple_freq_val"),
      ScanaStudio.gui_get_value("simple_freq_val")
    );
  }
  else if (mod_type == 0) //Sine
  {
    fm_builder.configure_sine(
      channel,
      ScanaStudio.gui_get_value("f_mod"),
      ScanaStudio.gui_get_value("ph_mod"),
      ScanaStudio.gui_get_value("f_car_min"),
      ScanaStudio.gui_get_value("f_car_max")
    );
  }
  else if (mod_type == 1) //Triangle
  {
    fm_builder.configure_triangle(
      channel,
      ScanaStudio.gui_get_value("f_mod"),
      ScanaStudio.gui_get_value("ph_mod"),
      ScanaStudio.gui_get_value("f_car_min"),
      ScanaStudio.gui_get_value("f_car_max")
    );
  }
  else if (mod_type == 2) //SawTooth
  {
    fm_builder.configure_sawtooth(
      channel,
      ScanaStudio.gui_get_value("f_mod"),
      ScanaStudio.gui_get_value("ph_mod"),
      ScanaStudio.gui_get_value("f_car_min"),
      ScanaStudio.gui_get_value("f_car_max")
    );
  }

  while ((ScanaStudio.builder_get_samples_acc(channel) < samples_to_build)
        && (ScanaStudio.abort_is_requested() == false) )
  {
    if (gen_type_group == 0)
    {
      fm_builder.build_cycle_sine();
    }
    else if (mod_type == 0) //Sine
    {
      fm_builder.build_cycle_sine();
    }
    else if (mod_type == 1) //Triangle
    {
      fm_builder.build_cycle_triangle();
    }
    else if (mod_type == 2) //SawTooth
    {
      fm_builder.build_cycle_sawtooth();
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
    var carrier_f = this.carrier_f_min + 0.5*((Math.sin(a)+1) * (this.carrier_f_max - this.carrier_f_min));
    var samples_per_cycle = (this.sample_rate) / carrier_f;
    this.samples_acc_per_mod_period+= samples_per_cycle;
		ScanaStudio.builder_add_cycles(this.channel,0.5,samples_per_cycle,1);
  },
  build_cycle_triangle : function()
  {
    if (this.modulation != "triangle")
    {
      if (this.modulation.length > 0)
      {
          ScanaStudio.console_error_msg("Please run configure_triangle() function before using build_cycle_sine()");
          this.modulation = ""; //don't display this message more than once
          return;
      }
    }
    if (this.samples_acc_per_mod_period > this.samples_per_mod_period)
    {
      this.samples_acc_per_mod_period -= this.samples_per_mod_period;
    }
    var amp = this.carrier_f_max - this.carrier_f_min;
    var quarter_period = this.samples_per_mod_period / 2;
    var carrier_f = ((amp/quarter_period) * (quarter_period - Math.abs((this.samples_acc_per_mod_period % (2*quarter_period)) - quarter_period))) + this.carrier_f_min;
    var samples_per_cycle = (this.sample_rate) / carrier_f;
    this.samples_acc_per_mod_period+= samples_per_cycle;
		ScanaStudio.builder_add_cycles(this.channel,0.5,samples_per_cycle,1);
  },
  build_cycle_sawtooth : function()
  {
    if (this.modulation != "sawtooth")
    {
      if (this.modulation.length > 0)
      {
          ScanaStudio.console_error_msg("Please run configure_triangle() function before using build_cycle_sine()");
          this.modulation = ""; //don't display this message more than once
          return;
      }
    }
    if (this.samples_acc_per_mod_period > this.samples_per_mod_period)
    {
      this.samples_acc_per_mod_period -= this.samples_per_mod_period;
    }
    var amp = this.carrier_f_max - this.carrier_f_min;
    var quarter_period = this.samples_per_mod_period / 4;
    var carrier_f = this.carrier_f_min + (amp * this.samples_acc_per_mod_period / this.samples_per_mod_period);
    var samples_per_cycle = (this.sample_rate) / carrier_f;
    this.samples_acc_per_mod_period+= samples_per_cycle;
		ScanaStudio.builder_add_cycles(this.channel,0.5,samples_per_cycle,1);
  },
  configure_sine : function(channel,modulation_freq,modulation_phase,carrier_f_min,carrier_f_max)
  {
    this.modulation = "sine";
    this.channel = channel;
    this.modulation_phase = modulation_phase*Math.PI/180;
    this.carrier_f_min = carrier_f_min;
    this.carrier_f_max = carrier_f_max;

    //Calculate working variable
    this.sample_rate = ScanaStudio.builder_get_sample_rate();
    this.samples_per_mod_period = this.sample_rate / modulation_freq;
    this.samples_acc_per_mod_period = 0;
  },
  configure_triangle : function(channel,modulation_freq,modulation_phase,carrier_f_min,carrier_f_max)
  {
    this.modulation = "triangle";
    this.channel = channel;
    this.modulation_phase = modulation_phase*Math.PI/180;
    this.carrier_f_min = carrier_f_min;
    this.carrier_f_max = carrier_f_max;

    //Calculate working variable
    this.sample_rate = ScanaStudio.builder_get_sample_rate();
    this.samples_per_mod_period = this.sample_rate / modulation_freq;
    this.samples_acc_per_mod_period = (modulation_phase/(2*Math.PI))*(this.samples_per_mod_period);
  },
  configure_sawtooth : function(channel,modulation_freq,modulation_phase,carrier_f_min,carrier_f_max)
  {
    this.modulation = "sawtooth";
    this.channel = channel;
    this.modulation_phase = modulation_phase*Math.PI/180;
    this.carrier_f_min = carrier_f_min;
    this.carrier_f_max = carrier_f_max;

    //Calculate working variable
    this.sample_rate = ScanaStudio.builder_get_sample_rate();
    this.samples_per_mod_period = this.sample_rate / modulation_freq;
    this.samples_acc_per_mod_period = (modulation_phase/(2*Math.PI))*(this.samples_per_mod_period);
  }
};
