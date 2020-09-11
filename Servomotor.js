/* Protocol meta info:
<NAME> Servomotor </NAME>
<DESCRIPTION>
Decode servomotor command signal.
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

/*Sources :https://arduino.blaisepascal.fr/controle-dun-servomoteur/
https://eskimon.fr/tuto-arduino-602-un-moteur-qui-a-de-la-t%C3%AAte-le-servomoteur
https://www.carnetdumaker.net/articles/controler-un-servomoteur-avec-une-carte-arduino-genuino/
*/


//Type "template..." in Atom.io editor (with ScanaStudio plugin) to generate code examples.
//Decoder GUI
function on_draw_gui_decoder()
{
  //Define decoder configuration GUI
  ScanaStudio.gui_add_ch_selector("ch_servo","Servo channel","Servomotor");
  ScanaStudio.gui_add_combo_box("type","Servomotor type");
  ScanaStudio.gui_add_item_to_combo_box("Standart (angle and speed)", true);
  ScanaStudio.gui_add_item_to_combo_box("Continuous rotation (sense and speed of rotation)",false);
  ScanaStudio.gui_add_engineering_form_input_box("pulse_min","Pulse width min (0 °)",100e-6,10e-3,1e-3,"s");
  ScanaStudio.gui_add_engineering_form_input_box("pulse_max","Pulse width max (180 °)",100e-6,10e-3,2e-3,"s");
  ScanaStudio.gui_add_text_input("angle_range","Angle Range (°)","180");
  ScanaStudio.gui_add_engineering_form_input_box("frequency","Frequency",5,500,50,"Hz");
  ScanaStudio.gui_add_combo_box("display","Angle Display");
  ScanaStudio.gui_add_item_to_combo_box("°",true);
  ScanaStudio.gui_add_item_to_combo_box("%",false);
}

//Evaluate decoder GUI
function on_eval_gui_decoder()
{
    if ((ScanaStudio.gui_get_value("pulse_min") < 200e-6) || (ScanaStudio.gui_get_value("pulse_max") > 5e-3))
    {
        return "Invalid Pulse width.";
    }
  return ""; //All good.
}

function reload_dec_gui_values()
{
    ch_servo = ScanaStudio.gui_get_value("ch_servo");
    type = ScanaStudio.gui_get_value("type");
    pulse_min = ScanaStudio.gui_get_value("pulse_min");
    pulse_max = ScanaStudio.gui_get_value("pulse_max");
    angle_range = Number(ScanaStudio.gui_get_value("angle_range"));
    frequency = Number(ScanaStudio.gui_get_value("frequency"));
    display = Number(ScanaStudio.gui_get_value("display"));
}

//Global variables
var sampling_rate;
var state_machine = 0;
var trs;
var delta_samples;
var type = 0; //Servomotor type
var frequency = 0;
var display = 0;
var unit = "";
var first_period = true;
var pulse_min = 0;
var pulse_max = 0;
var total_range = 0;
var start_high = 0;
var end_high = 0;
var angle = 0;
var speed = 0;
var speed_percentage = 0;
var angle_range = 0;
var last_angle = 0;
var last_start_high;
//Demo
var actual_angle = 0;

function on_decode_signals(resume)
{
  if (!resume) //If resume == false, it's the first call to this function.
  {
      //initialization code goes here, ex:
      sampling_rate = ScanaStudio.get_capture_sample_rate();
      reload_dec_gui_values();
      trs = ScanaStudio.trs_reset(ch_servo);
      trs = ScanaStudio.trs_get_next(ch_servo);
      var tmp_trs_sample_index;
      tmp_trs_sample_index = trs.sample_index;
      while( (tmp_trs_sample_index == trs.sample_index) && (ScanaStudio.trs_is_not_last(ch_servo) == true) )
      {
          trs = ScanaStudio.trs_get_next(ch_servo);
      }
      if (trs.value == 0)
      {
          trs = ScanaStudio.trs_get_previous(ch_servo);
      }
      //init global variables
      state_machine = 0;
      total_range = pulse_max - pulse_min;
      sample_per_period = sampling_rate/frequency;
      sample_per_max_length = pulse_max*sampling_rate;
      delta_samples = 20e-3*sampling_rate;
  }
  else
  {
      //ScanaStudio.console_info_msg("Decoding resumed");
  }
  while (ScanaStudio.abort_is_requested() == false)
  {
      // ScanaStudio.console_info_msg(".");
      if (!ScanaStudio.trs_is_not_last(ch_servo))
      {
          break;
      }
      while (ScanaStudio.trs_is_not_last(ch_servo) && (trs.sample_index + delta_samples) < ScanaStudio.get_available_samples(ch_servo))
      {
          switch (state_machine)
          {
              case 0 : //Searching the rising edge
              {
                  if (trs.value == 1) //Rising edge
                  {
                          start_high = trs.sample_index;
                          tmp_trs_sample_index = trs.sample_index;
                          while( (tmp_trs_sample_index == trs.sample_index) && (ScanaStudio.trs_is_not_last(ch_servo) == true) )
                          {
                              trs = ScanaStudio.trs_get_next(ch_servo);
                          }
                          state_machine = 1;
                          break;
                  }
                  else
                  {
                      if (!ScanaStudio.trs_is_not_last(ch_servo))
                      {
                          break;
                      }
                      trs = ScanaStudio.trs_get_next(ch_servo);
                  }
                  break;
              }//end case 0
              case 1 :
              {
                  if (trs.value == 0)
                  {
                      end_high = trs.sample_index;
                      var pulse_length = end_high - start_high;
                      if (display == 0)
                      {
                          angle = ((pulse_length/sampling_rate) - pulse_min)*angle_range/total_range;
                          unit = " °";
                      }
                      else
                      {
                          angle = ((pulse_length/sampling_rate) - pulse_min)/total_range*100;
                          unit = " %";
                      }
                      state_machine = 2;
                  }
                  else
                  {
                      if (!ScanaStudio.trs_is_not_last(ch_servo))
                      {
                          break;
                      }
                      trs = ScanaStudio.trs_get_next(ch_servo);
                  }
                  break;
              }
              case 2 :
              {
                  if (trs.value == 1)
                  {
                      if (type == 0) // Angle
                      {
                          if (first_period == true)
                          {
                              if (trs.value == 1)
                              {
                                  var test = ScanaStudio.dec_item_new(ch_servo,start_high,trs.sample_index - 1);
                                  ScanaStudio.dec_item_add_content("Angle : " + angle.toFixed(2) + unit);
                                  ScanaStudio.dec_item_add_content(angle.toFixed(2) + unit);
                                  ScanaStudio.dec_item_end();
                                  first_period = false;
                              }
                          }
                          else
                          {
                              speed = (start_high-last_start_high)/sampling_rate*60/(Math.abs(angle - last_angle));
                              if (trs.value == 1)
                              {
                                  ScanaStudio.dec_item_new(ch_servo,start_high,trs.sample_index - 1);
                                  if ((angle > last_angle - 0.02) && (angle < last_angle + 0.02))
                                  {
                                      ScanaStudio.dec_item_add_content("Angle : " + angle.toFixed(2) + unit + "and speed : no movement");
                                      ScanaStudio.dec_item_add_content(angle.toFixed(2) + unit);
                                  }
                                  else
                                  {
                                      ScanaStudio.dec_item_add_content("Angle : " + angle.toFixed(2) + unit + " and speed : " + speed.toFixed(4) + " sec/60°");
                                      ScanaStudio.dec_item_add_content(angle.toFixed(2) + unit + ", " + speed.toFixed(4) + " sec/60°");
                                      ScanaStudio.dec_item_add_content(angle.toFixed(2) + unit);
                                  }
                                  ScanaStudio.dec_item_end();
                              }
                          }
                      }
                      else
                      {
                          speed_percentage = (pulse_length/sampling_rate - (pulse_min + 0.5*total_range))/(0.5*total_range)*100;
                          ScanaStudio.dec_item_new(ch_servo,start_high,trs.sample_index - 1);
                          if (speed_percentage < 0)
                          {
                              speed_percentage = Math.abs(speed_percentage);
                              ScanaStudio.dec_item_add_content("Direction : Counter-Clockwise , Speed : " + speed_percentage.toFixed(2) + "%");
                              ScanaStudio.dec_item_add_content("Counter-Clockwise , Speed : " + speed_percentage.toFixed(2) + "%");
                              ScanaStudio.dec_item_add_content("Counter-Clockwise, " + speed_percentage.toFixed(2) + "%");
                              ScanaStudio.dec_item_add_content("-" + speed_percentage.toFixed(2) + "%");
                          }
                          else
                          {
                              ScanaStudio.dec_item_add_content("Direction : Clockwise , Speed : " + speed_percentage.toFixed(2) + "%");
                              ScanaStudio.dec_item_add_content("Clockwise , Speed : " + speed_percentage.toFixed(2) + "%");
                              ScanaStudio.dec_item_add_content("Clockwise, " + speed_percentage.toFixed(2) + "%");
                              ScanaStudio.dec_item_add_content("+" + speed_percentage.toFixed(2) + "%");
                          }
                          ScanaStudio.dec_item_end();
                      }
                      last_angle = angle;
                      last_start_high = start_high;
                      state_machine = 0;
                  }
                  else
                  {
                      if (!ScanaStudio.trs_is_not_last(ch_servo))
                      {
                          break;
                      }
                      trs = ScanaStudio.trs_get_next(ch_servo);
                  }
                  break;
              }
          }//end switch (state_machine)
      }//end while (ScanaStudio.trs_is_not_last(ch_servo) && trs.sample_index + 20e-3 < ScanaStudio.get_available_samples(ch_servo))
      break;
  }//end while (ScanaStudio.abort_is_requested() == false)
}//end function on_decode_signals

//Trigger sequence GUI
function on_draw_gui_trigger()
{

  ScanaStudio.gui_add_new_selectable_containers_group("trig_alternative","Select trigger alternative");
    ScanaStudio.gui_add_new_container("Trigger on a specific angle ",true); // trig_alternative = 0
        ScanaStudio.gui_add_text_input("trig_angle","Trigger Angle (%)","35");
        ScanaStudio.gui_end_container();
    ScanaStudio.gui_add_new_container("Trigger on a speed (continuous rotation)",false); // trig_alternative = 1
        ScanaStudio.gui_add_text_input("trig_speed","Trigger speed (%)","65");
        ScanaStudio.gui_add_info_label("Speed can go from -100% to +100%.\n" +
        "-100% is the max speed in counter-clockwise sense.");
        ScanaStudio.gui_end_container();
  ScanaStudio.gui_end_selectable_containers_group();

  ScanaStudio.gui_add_new_selectable_containers_group("trig_way","Trigger way");
  ScanaStudio.gui_add_new_container("Threshold (1 period)",true);
  ScanaStudio.gui_add_combo_box("sup_or_inf","Threshold type");
  ScanaStudio.gui_add_item_to_combo_box("Upper Threshold",true);
  ScanaStudio.gui_add_item_to_combo_box("Lower Threshold",false);
  ScanaStudio.gui_add_info_label("Upper-->Trig on values superior / Lower-->Trig on values inferior to the thresh\n"
  + "Example : Upper Threshold, Trigger Angle 40% \n"
  + "Measured value = 38% --> Don't trig\n"
  + "Measured value = 45% --> It'll trig");
  ScanaStudio.gui_end_container();
  ScanaStudio.gui_add_new_container("Cross the threshold (2 periods)",false);
  ScanaStudio.gui_add_combo_box("sup_to_inf","Threshold type");
  ScanaStudio.gui_add_item_to_combo_box("Increasing value",true);
  ScanaStudio.gui_add_item_to_combo_box("Decreasing value",false);
  ScanaStudio.gui_add_info_label("Example : Increasing value, Trigger angle 40%\n"
  + "First period angle = 45%, Second period angle = 35% --> Don't trig\n"
  + "First period angle = 35%, Second period angle = 45% --> It'll trig");
  ScanaStudio.gui_end_container();
  ScanaStudio.gui_add_new_container("Tolerance",false);
  ScanaStudio.gui_add_combo_box("tolerance","Tolerance between the value");
  ScanaStudio.gui_add_item_to_combo_box("1%",true);
  ScanaStudio.gui_add_item_to_combo_box("2.5%",false);
  ScanaStudio.gui_add_item_to_combo_box("5%",false);
  ScanaStudio.gui_add_item_to_combo_box("10%",false);
  ScanaStudio.gui_add_info_label("Example : Tolerance 10%, Trigger on angle 50% with pulse min 1ms and max 2ms.\n"
  + "--> (Without tolerance) Trigger angle (ms) = 1.5ms \n"
  + "--> (With tolerance) Trigger angle (ms) [1.35,1.65], (%) [35,65]");
  ScanaStudio.gui_end_container();
  ScanaStudio.gui_end_selectable_containers_group();
}//end on_draw_gui_trigger

function on_eval_gui_trigger()
{
    if ((ScanaStudio.gui_get_value("trig_angle") > 100) || (ScanaStudio.gui_get_value("trig_angle") < 0))
    {
        return "Invalid trigger angle, please select an angle between 0 and 100 %.";
    }
    if (ScanaStudio.gui_get_value("trig_speed") > 100 || ScanaStudio.gui_get_value("trig_speed") < -100)
    {
      return "Invalid trigger speed, please select a speed between -100% and 100 %.";
    }
    return "";
}//end on_eval_gui_trigger

function on_build_trigger()
{
  var trig_angle = Number(ScanaStudio.gui_get_value("trig_angle"));
  var trig_speed = Number(ScanaStudio.gui_get_value("trig_speed"));
  var trig_alternative = Number(ScanaStudio.gui_get_value("trig_alternative"));
  var trig_way = Number(ScanaStudio.gui_get_value("trig_way"));
  var angle_range = Number(ScanaStudio.gui_get_value("angle_range"));
  // sup_or_inf
  var sup_or_inf = ScanaStudio.gui_get_value("sup_or_inf");
  var sup_to_inf = ScanaStudio.gui_get_value("sup_to_inf");
  var tolerance = ScanaStudio.gui_get_value("tolerance");
  switch (tolerance)
  {
      case 0 :
      {
          tolerance = 0.01;
          break;
      }
      case 1 :
      {
          tolerance = 0.025;
          break;
      }
      case 2 :
      {
          tolerance = 0.05;
          break;
      }
      case 3 :
      {
          tolerance = 0.10;
          break;
      }
  }
  reload_dec_gui_values();
  var first_step = true;
  var full_range_time = pulse_max - pulse_min;

  if (trig_alternative == 0) //Trigger on a specific angle
  {
      trig_angle = trig_angle/100;
      if (trig_way == 0)
      {
          if (sup_or_inf == 1) // Lower Threshold
          {
              var min_time = pulse_min;
              var max_time = (pulse_min + (trig_angle)*full_range_time);
              ScanaStudio.flexitrig_append(trig_build_step("R"),-1,-1);
              ScanaStudio.flexitrig_append(trig_build_step("F"), min_time, max_time);
          }
          else // Upper Threshold
          {
              var min_time = (pulse_min + (trig_angle)*full_range_time);
              var max_time = pulse_max;
              ScanaStudio.flexitrig_append(trig_build_step("R"),-1,-1);
              ScanaStudio.flexitrig_append(trig_build_step("F"), min_time, max_time);
          }
      }
      else if (trig_way == 1)
      {
          if (sup_to_inf == 1) // High to Low
          {
              var min_time = pulse_min;
              var max_time = (pulse_min + (trig_angle)*full_range_time);
              ScanaStudio.flexitrig_append(trig_build_step("R"),-1,-1);
              ScanaStudio.flexitrig_append(trig_build_step("F"), max_time, pulse_max);
              ScanaStudio.flexitrig_append(trig_build_step("R"),-1,-1);
              ScanaStudio.flexitrig_append(trig_build_step("F"), pulse_min, max_time);
          }
          else // Low to High
          {
              var min_time = (pulse_min + (trig_angle)*full_range_time);
              var max_time = pulse_max;
              ScanaStudio.flexitrig_append(trig_build_step("R"),-1,-1);
              ScanaStudio.flexitrig_append(trig_build_step("F"), pulse_min, min_time);
              ScanaStudio.flexitrig_append(trig_build_step("R"),-1,-1);
              ScanaStudio.flexitrig_append(trig_build_step("F"), min_time, pulse_max);
          }
      }
      else
      {
          // Tolerance on the total length (Example with total length = 1ms and angle 40% with tolerance 10% --> Angle between 26% to 54%)
          var min_time = (1 - tolerance)*((trig_angle)*full_range_time + pulse_min) ;
          var max_time = (1 + tolerance)*((trig_angle)*full_range_time + pulse_min) ;
          ScanaStudio.flexitrig_append(trig_build_step("R"),-1,-1);
          ScanaStudio.flexitrig_append(trig_build_step("F"), min_time, max_time);
      }
  }//end Trigger on a specific angle

  else if (trig_alternative == 1) //Trigger on a specific speed
  {
      trig_speed = trig_speed/100;
      if (trig_way == 0)
      {
          if (sup_or_inf == 1) // Lower Threshold
          {
              var min_time = full_range_time/2 + pulse_min ;
              var max_time = (full_range_time/2 + (trig_speed)*full_range_time/2 + pulse_min);
              ScanaStudio.flexitrig_append(trig_build_step("R"),-1,-1);
              ScanaStudio.flexitrig_append(trig_build_step("F"), pulse_min, max_time);
          }
          else // Upper Threshold
          {
              var min_time = (full_range_time/2 + (trig_speed)*full_range_time/2 + pulse_min) ;
              var max_time = pulse_max;
              ScanaStudio.flexitrig_append(trig_build_step("R"),-1,-1);
              ScanaStudio.flexitrig_append(trig_build_step("F"), min_time, max_time);
          }
      }
      else if (trig_way == 1)
      {
          if (sup_to_inf == 1) // Decreasing value
          {
              var min_time = full_range_time/2 + pulse_min ;
              var max_time = (full_range_time/2 + (trig_speed)*full_range_time/2 + pulse_min);
              ScanaStudio.flexitrig_append(trig_build_step("R"),-1,-1);
              ScanaStudio.flexitrig_append(trig_build_step("F"), max_time, pulse_max);
              ScanaStudio.flexitrig_append(trig_build_step("R"),-1,-1);
              ScanaStudio.flexitrig_append(trig_build_step("F"), pulse_min, max_time);
          }
          else // Increasing value
          {
              var min_time = (full_range_time/2 + (trig_speed)*full_range_time/2 + pulse_min) ;
              var max_time = pulse_max;
              ScanaStudio.flexitrig_append(trig_build_step("R"),-1,-1);
              ScanaStudio.flexitrig_append(trig_build_step("F"), pulse_min, min_time);
              ScanaStudio.flexitrig_append(trig_build_step("R"),-1,-1);
              ScanaStudio.flexitrig_append(trig_build_step("F"), min_time, pulse_max);
          }
      }
      else
      {
          // Tolerance on the total length
          var min_time = (1 - tolerance)*(full_range_time/2 + (trig_speed)*full_range_time/2 + pulse_min);
          var max_time = (1 + tolerance)*(full_range_time/2 + (trig_speed)*full_range_time/2 + pulse_min);
          ScanaStudio.flexitrig_append(trig_build_step("R"),-1,-1);
          ScanaStudio.flexitrig_append(trig_build_step("F"), min_time, max_time);
      }
  }//end Trigger on a specific speed
   ScanaStudio.flexitrig_print_steps();

}//end on_build_trigger

function trig_build_step (step_desc)
{
	var i;
	var step = "";

	for (i = 0; i < ScanaStudio.get_device_channels_count(); i++)
	{
        switch (i)
        {
            case ch_servo: step = step_desc + step; break;
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
    var servo_builder = ScanaStudio.BuilderObject;
    var sample_rate = ScanaStudio.builder_get_sample_rate();
    var ch_servo = ScanaStudio.gui_get_value("ch_servo");
    var silence_period = samples_to_build/100;
    reload_dec_gui_values();
    var baud = 50;
    servo_builder.config(ch_servo, sample_rate, baud, pulse_min, pulse_max, angle_range);

    ScanaStudio.builder_add_samples(ch_servo,0, silence_period);
    servo_builder.put_angle(0);
    servo_builder.put_angle(60);
    for (i=0; i<30; i++)
    {
        servo_builder.put_angle(angle_range*i/29);
    }
    while(ScanaStudio.builder_get_samples_acc(ch_servo) < samples_to_build )
    {
        servo_builder.put_rng_angle();
    }
}


//Signal builder GUI
function on_draw_gui_signal_builder()
{
    var max_car_f = 500; //at least 10 samples per period
    var max_mod_f = max_car_f/10; //At least 5 carrier periods per modulations period
    var min_mod_f = 2 * ScanaStudio.builder_get_sample_rate()
                    / ScanaStudio.builder_get_maximum_samples_count(); //at least 2 full periods
    var def_mod_f = Math.round((max_mod_f + min_mod_f) / 2);
    var def_car_f = 50;
    if (min_mod_f >= max_mod_f)
    {
      ScanaStudio.gui_add_info_label("GUI ERROR: Capture time is insufficient");
      ScanaStudio.console_error_msg("GUI ERROR: Capture time is insufficient");
      return;
    }
    //Define decoder configuration GUI
    ScanaStudio.gui_add_ch_selector("channel","Target channel","PWM");
    ScanaStudio.gui_add_engineering_form_input_box("min_pulse","Pulse width min (0°)",200e-6,5e-3,1e-3,"s");
    ScanaStudio.gui_add_engineering_form_input_box("max_pulse","Pulse width max (180°)",200e-6,5e-3,2e-3,"s");
    ScanaStudio.gui_add_info_label("Minimum: " + ScanaStudio.engineering_notation(200e-6,3) + "s\n"
    +"Maximum: " + ScanaStudio.engineering_notation(5e-3,3) + "s"
    );

    ScanaStudio.gui_add_new_selectable_containers_group("gen_type_group","Please select type of signals");
    ScanaStudio.gui_add_new_container("Fixed pulse width",true);
    ScanaStudio.gui_add_engineering_form_input_box("simple_freq_val","Frequency",min_mod_f,max_car_f,def_car_f,"Hz");
    ScanaStudio.gui_add_info_label("Minimum: " + ScanaStudio.engineering_notation(min_mod_f,3) + "Hz\n"
                                    +"Maximum: " + ScanaStudio.engineering_notation(max_car_f,3) + "Hz"
                                    );
      ScanaStudio.gui_add_engineering_form_input_box("simple_angle_value","Angle",0,100,50,"%");
        ScanaStudio.gui_add_engineering_form_input_box("car_phase","Phase shift",0,360,0,"°");
      ScanaStudio.gui_end_container();
      ScanaStudio.gui_add_new_container("Modulated pulse width",false);
        ScanaStudio.gui_add_combo_box("mod_type","Modulation type");
          ScanaStudio.gui_add_item_to_combo_box("Sine",true);
          ScanaStudio.gui_add_item_to_combo_box("Triangle",false);
          ScanaStudio.gui_add_item_to_combo_box("SawTooth",false);
        ScanaStudio.gui_add_engineering_form_input_box("f_mod","Modulation frequency",min_mod_f,max_mod_f,3,"Hz");
        ScanaStudio.gui_add_engineering_form_input_box("ph_mod","Modulation phase",0,360,"0","DEG(°)");
        ScanaStudio.gui_add_engineering_form_input_box("freq_carrier","Carrier frequency",min_mod_f,max_car_f,50,"Hz");
        ScanaStudio.gui_add_engineering_form_input_box("angle_min","Minimum angle",0,100,10,"%");
        ScanaStudio.gui_add_engineering_form_input_box("angle_max","Maximum angle",0,100,90,"%");
        ScanaStudio.gui_add_info_label("Modulation frequency range:" + ScanaStudio.engineering_notation(min_mod_f,3) + "Hz to "
                                      + ScanaStudio.engineering_notation(max_mod_f,3) + "Hz"
                                      );
      ScanaStudio.gui_end_container();
    ScanaStudio.gui_end_selectable_containers_group();
    ScanaStudio.gui_add_info_label("The angles are in percent of the maximum angle range");
}

//Evaluate signal builder GUI
function on_eval_gui_signal_builder()
{
  ScanaStudio.set_script_instance_name("Servo Builder on CH "+ (ScanaStudio.gui_get_value("channel")+1).toString());
  if ((ScanaStudio.gui_get_value("min_pulse") < 200e-6) || (ScanaStudio.gui_get_value("min_pulse") > 5e-3))
  {
      return "Invalid Pulse width.";
  }
  if (ScanaStudio.gui_get_value("ph_mod") > 360 || ScanaStudio.gui_get_value("ph_mod") < 0)
  {
      return "Invalid Modulation phase";
  }
  if (ScanaStudio.gui_get_value("angle_min") > 100 || ScanaStudio.gui_get_value("angle_min") < 0)
  {
      return "Angle can't be lower than 0% and superior than 100%.";
  }
  if (ScanaStudio.gui_get_value("angle_max") > 100 || ScanaStudio.gui_get_value("angle_max") < 0)
  {
      return "Angle can't be lower than 0% or superior than 100%.";
  }
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
    var min_pulse = ScanaStudio.gui_get_value("min_pulse");
    var max_pulse = ScanaStudio.gui_get_value("max_pulse");
    var freq_carrier = ScanaStudio.gui_get_value("freq_carrier"), //carrier_f
    if (gen_type_group == 0) //Simple fixed frequency & fixed pwm.
    {
        freq_carrier = ScanaStudio.gui_get_value("simple_freq_val");
        var percent_of_max_angle = ScanaStudio.gui_get_value("simple_angle_value")/100;
        var duty_min = (percent_of_max_angle*(max_pulse - min_pulse) + min_pulse)*(freq_carrier);
        var duty_max = duty_min;
      //Here we use the SawTooth modulator with a fixed duty cycle
      //to achieve simple fixed frequency signal building
      pwm_builder.configure_sawtooth(
        channel, //channel
        50, //modulation_freq
        0, //modulation_phase
        ScanaStudio.gui_get_value("simple_freq_val"), //carrier_f
        duty_min,//duty_min
        duty_max,//duty_max
        ScanaStudio.gui_get_value("car_phase")
      );
    }
    else if (mod_type == 0) //Sine
    {
        var duty_min = (ScanaStudio.gui_get_value("angle_min")/100*(max_pulse - min_pulse) + min_pulse)*(freq_carrier);
        var duty_max = (ScanaStudio.gui_get_value("angle_max")/100*(max_pulse - min_pulse) + min_pulse)*(freq_carrier);
      pwm_builder.configure_sine(
          channel, //channel
          ScanaStudio.gui_get_value("f_mod"), //modulation_freq
          ScanaStudio.gui_get_value("ph_mod"), //modulation_phase
          ScanaStudio.gui_get_value("freq_carrier"), //carrier_f
          duty_min,//duty_min
          duty_max//duty_max
      );
    }
    else if (mod_type == 1) //Triangle
    {
        var duty_min = (ScanaStudio.gui_get_value("angle_min")/100*(max_pulse - min_pulse) + min_pulse)*(freq_carrier);
        var duty_max = (ScanaStudio.gui_get_value("angle_max")/100*(max_pulse - min_pulse) + min_pulse)*(freq_carrier);
        pwm_builder.configure_triangle(
          channel, //channel
          ScanaStudio.gui_get_value("f_mod"), //modulation_freq
          ScanaStudio.gui_get_value("ph_mod"), //modulation_phase
          ScanaStudio.gui_get_value("freq_carrier"), //carrier_f
          duty_min,//duty_min
          duty_max//duty_max
      );
    }
    else if (mod_type == 2) //SawTooth
    {
        var duty_min = (ScanaStudio.gui_get_value("angle_min")/100*(max_pulse - min_pulse) + min_pulse)*(freq_carrier);
        var duty_max = (ScanaStudio.gui_get_value("angle_max")/100*(max_pulse - min_pulse) + min_pulse)*(freq_carrier);
      pwm_builder.configure_sawtooth(
          channel, //channel
          ScanaStudio.gui_get_value("f_mod"), //modulation_freq
          ScanaStudio.gui_get_value("ph_mod"), //modulation_phase
          ScanaStudio.gui_get_value("freq_carrier"), //carrier_f
          duty_min,//duty_min
          duty_max//duty_max
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
ScanaStudio.BuilderObject =
{
    put_angle : function(angle)
    {
        var samples_high = Math.floor(this.samples_per_pulse_min + this.samples_per_degree*angle);
        var samples_low = Math.floor(this.samples_per_period - samples_high);
        ScanaStudio.builder_add_samples(this.ch_servo,1,samples_high);
        ScanaStudio.builder_add_samples(this.ch_servo,0,samples_low);
        actual_angle = angle;
    },

    put_rng_angle : function ()
    {
        var rng_angle = Math.floor(Math.random()*angle_range*100)/100;
        var samples_high = Math.floor(this.samples_per_pulse_min + this.samples_per_degree*rng_angle);
        var samples_low = this.samples_per_period - samples_high;
        ScanaStudio.builder_add_samples(this.ch_servo,1,samples_high);
        ScanaStudio.builder_add_samples(this.ch_servo,0,samples_low);
        actual_angle = rng_angle;
    },

    put_silence : function(ms)
    {
        var time = 0;
        while (ms > time)
        {
            this.put_angle(actual_angle);
            time = time + 1/baud*1000;
        }
    },

    config : function(ch_servo, sample_rate, baud, pulse_min, pulse_max, angle_range)
    {
        this.ch_servo = ch_servo;
        this.samples_per_second = sample_rate;
        this.samples_per_pulse_min = sample_rate*pulse_min;
        this.samples_per_millisecond = this.samples_per_second/1000;
        this.samples_per_period = sample_rate/baud;
        this.samples_per_degree = (pulse_max - pulse_min)*sample_rate/angle_range;
        this.angle_range = angle_range;
    },

    //----------------------------------------------------------------------------------------------------------------------------------------------------------------------//
    //                                                                         PWM Builder                                                                                  //
    //----------------------------------------------------------------------------------------------------------------------------------------------------------------------//

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
    var amp = this.duty_max - this.duty_min;
    this.samples_acc_per_mod_period+= this.samples_per_cycle;
    if (this.samples_acc_per_mod_period > this.samples_per_mod_period)
    {
        this.samples_acc_per_mod_period -= this.samples_per_mod_period;
    }
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
    // this.modulation_phase = modulation_phase*Math.PI/180;
    this.carrier_frequency = carrier_f;
    this.duty_min = duty_min;
    this.duty_max = duty_max;

    //Calculate working variable
    this.sample_rate = ScanaStudio.builder_get_sample_rate();
    this.samples_per_mod_period = this.sample_rate / modulation_freq;
    this.samples_per_cycle = (this.sample_rate) / this.carrier_frequency;
    this.duty_increment_per_cycle = this.samples_per_cycle / (this.samples_per_mod_period);
    this.samples_acc_per_mod_period = (modulation_phase/(360))*(this.samples_per_mod_period);
  },
  configure_sawtooth : function(channel,modulation_freq,modulation_phase,carrier_f,duty_min,duty_max,carrier_phase)
  {
    this.modulation = "sawtooth";
    this.channel = channel;
    // this.modulation_phase = modulation_phase*Math.PI/180;
    this.carrier_frequency = carrier_f;
    this.duty_min = duty_min;
    this.duty_max = duty_max;

    //Calculate working variable
    this.sample_rate = ScanaStudio.builder_get_sample_rate();
    this.samples_per_mod_period = this.sample_rate / modulation_freq;
    this.samples_per_cycle = (this.sample_rate) / this.carrier_frequency;
    this.duty_increment_per_cycle = this.samples_per_cycle / (this.samples_per_mod_period);
    this.samples_acc_per_mod_period = (modulation_phase/(360))*(this.samples_per_mod_period);

    //Do the carrier phase shift
    if ((carrier_phase == 0) || (carrier_phase === undefined))
    {
    }
    else if (carrier_phase <= ((1-duty_min)*360))
    {
        ScanaStudio.builder_add_samples(channel,0,this.samples_per_cycle*carrier_phase/360);
    }
    else
    {
        var samples_high = this.samples_per_cycle*carrier_phase/360 - this.samples_per_cycle*(1-duty_min);
        ScanaStudio.builder_add_samples(channel, 1, samples_high);
        ScanaStudio.builder_add_samples(channel, 0, this.samples_per_cycle*(1-duty_min));
    }
  },

    //----------------------------------------------------------------------------------------------------------------------------------------------------------------------//
    //                                                                    END  PWM Builder                                                                                  //
    //----------------------------------------------------------------------------------------------------------------------------------------------------------------------//
};//end BuilderObject
