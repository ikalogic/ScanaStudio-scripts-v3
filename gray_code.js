/* Protocol meta info:
<NAME> Gray Code </NAME>
<DESCRIPTION>
gray code support for ScanaStudio.
</DESCRIPTION>
<VERSION> 1.0 </VERSION>
<AUTHOR_NAME>	Juille Neil, Ibrahim KAMAL	</AUTHOR_NAME>
<AUTHOR_URL> contact@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki/ </HELP_URL>
<COPYRIGHT> Copyright 2019 Ikalogic SAS </COPYRIGHT>
<LICENSE>	This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
	V1.1: Added CSV plotting option
	V1.0: Initial release & create builder demo
	V1.1: Decode signial
</RELEASE_NOTES>
*/

/*
TODO
~~~~
* Trigger
*/

var ENCODING = "UTF-8";

//Decoder GUI
function on_draw_gui_decoder()
{
	for (var i = 0; i < ScanaStudio.get_device_channels_count(); i++)
	{
		ScanaStudio.gui_add_combo_box("ch_b"+i.toString(),"Bit " + i.toString() + " Channel");
		ScanaStudio.gui_add_item_to_combo_box("Not used",false);
		for (var c = 0; c < ScanaStudio.get_device_channels_count(); c++)
		{
			if (c==i)
			{
				ScanaStudio.gui_add_item_to_combo_box("Ch "+(c+1).toString(),true);
			}
			else
			{
					ScanaStudio.gui_add_item_to_combo_box("Ch "+(c+1).toString(),false);
			}
		}
	}
	ScanaStudio.gui_add_check_box("show_encoder_count","Show calculated encoder count",true);
	ScanaStudio.gui_add_new_selectable_containers_group("gray_type","Gray encoder type");
		ScanaStudio.gui_add_new_container("Rotary encoder",true);
			//ScanaStudio.gui_add_info_label("Angle per step is automatically detected using the number of bits");
			ScanaStudio.gui_add_info_label("The gear ratio is the number of turns on the output shaft for each turn of the input (motor) shaft");
			ScanaStudio.gui_add_text_input("rot_enc_ratio","Gear ratio","1.0")
		ScanaStudio.gui_end_container();
		ScanaStudio.gui_add_new_container("Linear encoder",false);
			ScanaStudio.gui_add_engineering_form_input_box("lin_enc_step","Linear encoder step",1e-9,1,"1e-6","m");
		ScanaStudio.gui_end_container();
	ScanaStudio.gui_end_selectable_containers_group();

	 ScanaStudio.gui_add_new_tab("CSV plotting options",false);
	 	ScanaStudio.gui_add_info_label(" Select a file where decoded values should be saved."
																	+ "\nClear this field if you don't want to save to file."
																);
	 	ScanaStudio.gui_add_file_save("csv_dest","Target CSV file","*.csv");
		ScanaStudio.gui_add_check_box("write_file_position","Write position values to file",false);
		ScanaStudio.gui_add_check_box("write_file_velocity","Write velocity values to file",false);
		ScanaStudio.gui_add_check_box("write_file_acceleration","Write acceleration values to file",false);

		ScanaStudio.gui_add_combo_box("decimal_point","Decimal point character");
			ScanaStudio.gui_add_item_to_combo_box("Dot (12.3)",true);
			ScanaStudio.gui_add_item_to_combo_box("Comma (12,3)",false);
	 ScanaStudio.gui_end_tab();
}

//Evaluate decoder GUI
function on_eval_gui_decoder()
{
	var unused_channels_count=0;
	var ch_gray = new Array;
	ch_gray=get_gui_gray_channels();
	for (var i = 0; i < ch_gray.length; i++)
	{
		if (ch_gray[i]==-1)
		{
			unused_channels_count++;
		}
	}

	var ok=0;

	for (var i = 0; i < ch_gray.length-unused_channels_count; i++)
	{
		if (ch_gray[i]==-1)
		{
			return "Error: incorrect channels configuration for Gray decoder";
		}
	}

	for(var i = 0;i<ch_gray.length-unused_channels_count;i++)
	{
		for(var j = 0 ; j<ch_gray.length-unused_channels_count;j++)
		{
			if((ch_gray[i]==ch_gray[j])&&!(i==j))
			{
				return "Error: Gray channels " + (i+1).toString() + " and " + (j+1).toString() + " are both connected to logic channel Ch " + (ch_gray[i]+1).toString();
			}
		}
	}

	if (ScanaStudio.gui_get_value("gray_type") == 0) //rotary encoder
	{
		if (isNaN(ScanaStudio.gui_get_value("rot_enc_ratio")))
		{
			return "Gear ratio is not a valid number";
		}
	}

	ScanaStudio.set_script_instance_name("Gray code (" + (ch_gray.length-unused_channels_count).toString() + " bits)");

  return "" //All good.
}

function get_gui_gray_channels()
{
	var ch_gray = [];
	for (var i = 0; i < ScanaStudio.get_device_channels_count(); i++)
	{
		//Unused channels will be coded as "-1"
		ch_gray.push(ScanaStudio.gui_get_value("ch_b"+i.toString())-1);
	}
	return ch_gray;
}


function get_used_gray_channels_list()
{
		var ch_gray = new Array;
		ch_gray=get_gui_gray_channels();
		for (var i = 0; i < ch_gray.length; i++)
		{
			if (ch_gray[i]==-1)
			{
					ch_gray.splice(i, 1);
					i--;
			}
		}

		return ch_gray;
}

//Global variables

var sampling_rate;
var state_machine;
var lagging_channel;
var lagging_sample;
var ch_list;
var ch_display;
var trs = [];
var prev_trs = [];
var start_sample;
var gray_code;
var binary_code;
var all_channels_ready;
var gray_bits_count;
var prev_binary_code;
var gray_max_value;
var direction_text,direction_short_text,encoder_value_text;
var gray_type;
var increment_step;
var encoder_value;
var show_encoder_count;
var file_handle;
var write_file_position;
var write_file_velocity;
var write_file_acceleration;
var decimal_chr;
var rot_enc_ratio;
var lin_enc_step;

function on_decode_signals(resume)
{

  if (!resume) //If resume == false, it's the first call to this function.
  {
      state_machine = 0;
			ch_list = get_used_gray_channels_list();
			gray_type = ScanaStudio.gui_get_value("gray_type");
      sampling_rate = ScanaStudio.get_capture_sample_rate();
			show_encoder_count = ScanaStudio.gui_get_value("show_encoder_count");
			write_file_position = ScanaStudio.gui_get_value("write_file_position");
			write_file_velocity = ScanaStudio.gui_get_value("write_file_velocity");
			write_file_acceleration = ScanaStudio.gui_get_value("write_file_acceleration");
			rot_enc_ratio = ScanaStudio.gui_get_value("rot_enc_ratio");
			lin_enc_step = ScanaStudio.gui_get_value("lin_enc_step");
			if (ScanaStudio.gui_get_value("decimal_point") == 0)
			{
				decimal_chr = ".";
			}
			else
			{
				decimal_chr = ",";
			}
			trs = [];
			start_sample = 0;
			lagging_channel = 0;
			lagging_sample = 0;
			prev_binary_code = -1;
			gray_bits_count = ch_list.length;
			gray_max_value = (Math.pow(2,ch_list.length)-1);
			encoder_value = 0;

			if (gray_type == 0) //Rotary
			{
				increment_step = (360 / (gray_max_value+1)) * rot_enc_ratio;
			}
			else
			{
				increment_step = lin_enc_step;
			}

			//define which channel will be used to show decoded items
			ch_display = ch_list[0];
			for(var i = 0; i < gray_bits_count; i++)
			{
				if(ch_list[i] < ch_display)
				{
					ch_display=ch_list[i];
				}
			}

			//Reset iterators
			for (var i = 0 ; i < gray_bits_count; i++)
			{
				ScanaStudio.trs_reset(ch_list[i]);
				trs.push(ScanaStudio.trs_get_next(ch_list[i]));
			}

			file_handle = ScanaStudio.file_system_open("csv_dest","w");

			if (file_handle >= 0)
			{
				append_header_to_file();
			}

  }

  while (ScanaStudio.abort_is_requested() == false)
  {
		/*    if we reached the last transition on all channels, break the loop         */
		if ((!ScanaStudio.trs_is_not_last(ch_list[0])) &&(!ScanaStudio.trs_is_not_last(ch_list[1])) &&(!ScanaStudio.trs_is_not_last(ch_list[2])) &&(!ScanaStudio.trs_is_not_last(ch_list[3])))
		{
			break;
		}

		switch (state_machine)
    {
			case 0: //Advance to first transition on all channels
				all_channels_ready = true;
				for (var i = 0; i < gray_bits_count; i++)
				{
					if (trs[i].sample_index == 0)
					{
						all_channels_ready = false;
						prev_trs[i] = trs[i];
						trs[i] = ScanaStudio.trs_get_next(ch_list[i]);

					}
				}

				if (all_channels_ready == true)
				{
					state_machine++;
				}
				break;
      case 1: //Advance lagging channel only
				lagging_channel = get_lagging_channel(); //Find lagging channel
				//ScanaStudio.console_info_msg("lagging_channel="+lagging_channel+" at " + trs[lagging_channel].sample_index,trs[lagging_channel].sample_index);
				start_sample = trs[lagging_channel].sample_index;
				prev_trs[lagging_channel] = trs[lagging_channel];
				trs[lagging_channel] = ScanaStudio.trs_get_next(ch_list[lagging_channel]);
				//ScanaStudio.console_info_msg("lagging_channel after advance="+lagging_channel+" at " + trs[lagging_channel].sample_index + ", val = " + trs[lagging_channel].value,trs[lagging_channel].sample_index);
				lagging_sample = trs[lagging_channel].sample_index;

				if (trs[lagging_channel].sample_index > 0)
				{
					lagging_channel = get_lagging_channel(); //Update lagging channel number
					//build gray code
					gray_code = 0;
					for (var i = 0; i < gray_bits_count; i++)
					{
						gray_code |= ((prev_trs[i].value) << i);
					}

					//Convert to binary code
					binary_code = Number.fromGrayCode(gray_code);

					//Add dec item
					ScanaStudio.dec_item_new(ch_display,start_sample,trs[lagging_channel].sample_index);
					//ScanaStudio.console_info_msg("prev_binary_code="+prev_binary_code+" binary_code="+binary_code+", gray_code = " + gray_code ,start_sample);
					if (prev_binary_code == -1)
					{
						direction_text = " Direction ?"; //unknown direction (yet)
						direction_short_text = " "; //unknown direction (yet)
					}
					else if (((prev_binary_code + 1) & gray_max_value) == binary_code)
					{
						direction_text = " +";
						direction_short_text = "+";
						encoder_increment();
					}
					else if (((prev_binary_code - 1) & gray_max_value) == binary_code)
					{
						direction_text = " -";
						direction_short_text = "-";
						encoder_decrement();
					}
					else
					{
						//ScanaStudio.console_warning_msg("prev_binary_code="+prev_binary_code+", gray_max_value="+gray_max_value+", check="+((prev_binary_code + 1) & gray_max_value)+" binary_code="+binary_code);
						ScanaStudio.dec_item_emphasize_warning();
					}

					if (show_encoder_count == true)
					{
						if (gray_type == 0)
						{
							encoder_value_text = " Count = " + encoder_value.toString(10) + "°";
						}
						else
						{
							encoder_value_text = " Count = " + ScanaStudio.engineering_notation(encoder_value,3) + "m";
						}
					}
					else
					{
						encoder_value_text = "";
					}

					ScanaStudio.dec_item_add_content(binary_code.toString(10) + direction_text + encoder_value_text);
					ScanaStudio.dec_item_add_content(binary_code.toString(10) + direction_text);
					ScanaStudio.dec_item_add_content(binary_code.toString(10) + direction_short_text);

					if (file_handle >= 0)
					{
						append_new_line_to_file(start_sample/sampling_rate);
					}

					prev_binary_code = binary_code;

					break;
				}
      default: //we should nevel arrive here...
				state_machine = 0;
    }
  }

	if (file_handle >= 0)
	{
		ScanaStudio.file_system_close(file_handle);
	}
}

//Decoder helper function
function get_lagging_channel()
{
	var lag_ch = 0;
	var lag_s = trs[0].sample_index;
	for (var i = 0; i < gray_bits_count; i++)
	{
		if (trs[i].sample_index < lag_s)
		{
			lag_ch = i;
			lag_s = trs[i].sample_index;
		}
	}
	return lag_ch;
}

function encoder_increment()
{
	encoder_value += increment_step;
	if (gray_type == 0)
	{
		if (encoder_value >= 360)
		{
			encoder_value -= 360;
		}
	}
}

function encoder_decrement()
{
	encoder_value -= increment_step;
	if (gray_type == 0)
	{
		if (encoder_value < 0)
		{
			encoder_value += 360;
		}
	}
}

function append_header_to_file()
{
	ScanaStudio.file_system_write_text(file_handle,"Time [s]",ENCODING);
	ScanaStudio.file_system_write_text(file_handle,";",ENCODING);
	ScanaStudio.file_system_write_text(file_handle,"Gray code [dec]",ENCODING);
	ScanaStudio.file_system_write_text(file_handle,";",ENCODING);
	ScanaStudio.file_system_write_text(file_handle,"Decimal code [dec]",ENCODING);
	ScanaStudio.file_system_write_text(file_handle,";",ENCODING);

	if (write_file_position)
	{
		ScanaStudio.file_system_write_text(file_handle,"Position ",ENCODING);
		if (gray_type == 0)
		{
				ScanaStudio.file_system_write_text(file_handle,"[Deg.]",ENCODING);
		}
		else
		{
			ScanaStudio.file_system_write_text(file_handle,"[m]",ENCODING);
		}
		ScanaStudio.file_system_write_text(file_handle,";",ENCODING);
	}

	if (write_file_velocity)
	{
		ScanaStudio.file_system_write_text(file_handle,"velocity ",ENCODING);
		if (gray_type == 0)
		{
				ScanaStudio.file_system_write_text(file_handle,"[°/s]",ENCODING);
		}
		else
		{
			ScanaStudio.file_system_write_text(file_handle,"[m/s]",ENCODING);
		}
		ScanaStudio.file_system_write_text(file_handle,";",ENCODING);
	}

	if (write_file_acceleration)
	{
		ScanaStudio.file_system_write_text(file_handle,"Acceleration",ENCODING);
		if (gray_type == 0)
		{
				ScanaStudio.file_system_write_text(file_handle,"[°/s²]",ENCODING);
		}
		else
		{
			ScanaStudio.file_system_write_text(file_handle,"[m/s²]",ENCODING);
		}
		ScanaStudio.file_system_write_text(file_handle,";",ENCODING);
	}
	ScanaStudio.file_system_write_text(file_handle,"\n",ENCODING);
}


var prev_enc_value = -1;
var prev_velocity = -1;
function append_new_line_to_file(time_s)
{
	var velocity = 0;
	var acc = 0;
	ScanaStudio.file_system_write_text(file_handle,time_s.toString().replace(".",decimal_chr).replace(",",decimal_chr),ENCODING);
	ScanaStudio.file_system_write_text(file_handle,";",ENCODING);
	ScanaStudio.file_system_write_text(file_handle,gray_code.toString(10),ENCODING);
	ScanaStudio.file_system_write_text(file_handle,";",ENCODING);
	ScanaStudio.file_system_write_text(file_handle,binary_code.toString(10),ENCODING);
	ScanaStudio.file_system_write_text(file_handle,";",ENCODING);

	if (write_file_position)
	{
		ScanaStudio.file_system_write_text(file_handle,encoder_value.toString().replace(".",decimal_chr).replace(",",decimal_chr),ENCODING);
		ScanaStudio.file_system_write_text(file_handle,";",ENCODING);
	}

	if (write_file_velocity)
	{
		if  (prev_enc_value >= 0)
		{
				velocity = (encoder_value - prev_enc_value)/time_s;
		}
		ScanaStudio.file_system_write_text(file_handle,velocity.toString().replace(".",decimal_chr).replace(",",decimal_chr),ENCODING);
		ScanaStudio.file_system_write_text(file_handle,";",ENCODING);
	}

	if (write_file_acceleration)
	{
		if  (prev_velocity >= 0)
		{
				acc = (velocity - prev_velocity)/time_s;
		}
		ScanaStudio.file_system_write_text(file_handle,acc.toString().replace(".",decimal_chr).replace(",",decimal_chr),ENCODING);
		ScanaStudio.file_system_write_text(file_handle,";",ENCODING);
	}

	prev_enc_value = encoder_value;
	prev_velocity = velocity;
	ScanaStudio.file_system_write_text(file_handle,"\n",ENCODING);
}


//Function called to generate demo siganls (when no physical device is attached)
function on_build_demo_signals()
{
	//Use the function below to get the number of samples to be built
	var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
	var gray_builder = ScanaStudio.BuilderObject;
	sampling_rate = ScanaStudio.builder_get_sample_rate();
	var ch_list = get_used_gray_channels_list();
	gray_builder.config(ch_list);
	gray_max_value = (Math.pow(2,ch_list.length)-1);


	var gray_code_counter = 0;
	var max_period = samples_to_build/200;
	var min_period = max_period / 100;
	var period = (max_period+min_period)/2;
	var step = min_period;

	while (ScanaStudio.builder_get_samples_acc(ch_list[0]) < samples_to_build)
	{
		if (ScanaStudio.abort_is_requested())
		{
			break;
		}

		period += step;
		if ((period > max_period) || (period < min_period))
		{
			step = -step;
		}
		gray_code_counter++;
		if (gray_code_counter > gray_max_value)
		{
			gray_code_counter = 0;
		}
		gray_builder.put_integer(gray_code_counter,period);
		//ScanaStudio.console_info_msg("step="+step+", max_period="+max_period+ ", period="+period);
	}
}


//Builder object that can be shared to other scripts
ScanaStudio.BuilderObject = {
  put_silence : function(s)
  {
		for (i = 0; i < this.channel.length ; i++)
		{
	  ScanaStudio.builder_add_samples(this.channel[i],this.bit_value[i],s);
		}
  },
  put_integer : function(decimal_value,period_samples)
  {

	  var gray = Number.toGrayCode(decimal_value);

	  var i = 0;

	  for (i = 0; i < this.channel.length ; i++)
	  {
		  this.bit_value[i] = (gray >> i) & 0x1;
			ScanaStudio.builder_add_samples(this.channel[i],this.bit_value[i],period_samples);
	  }
  },
  config : function(ch_gray)
  {
		this.channel = ch_gray;
		this.bit_value = [];

  }
};


//Helper functions (Inspired from silentmatt's code https://gist.github.com/silentmatt/136599)
Number.toGrayCode = function(n) {
    return n ^ (n >>> 1);
};

Number.fromGrayCode = function(gn) {
    var g = gn.toString(2).split("");
    var b = [];
    b[0] = g[0];
    for (var i = 1; i < g.length; i++) {
        b[i] = g[i] ^ b[i - 1];
    }
    return parseInt(b.join(""), 2);
};
