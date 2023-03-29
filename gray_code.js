/* Protocol meta info:
<NAME> Gray Code </NAME>
<DESCRIPTION>
gray code support for ScanaStudio.
</DESCRIPTION>
<VERSION> 0.4 </VERSION>
<AUTHOR_NAME>	Juille Neil, Ibrahim KAMAL	</AUTHOR_NAME>
<AUTHOR_URL> contact@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki/ </HELP_URL>
<COPYRIGHT> Copyright 2019 Ikalogic SAS </COPYRIGHT>
<LICENSE>	This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.4: Fixed the on_build_demo_signals, on_decode_signals and added a trigger. Also added a table in the GUI in order to help users.
V0.3: Added dec_item_end() for each dec_item_new().
V0.2: Added CSV plotting option
V0.1: Initial release and create builder demo
</RELEASE_NOTES>
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
var ch_list = [];
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

		ch_display = ch_list[0];

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
		if (is_all_last_trs())
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
			start_sample = trs[lagging_channel].sample_index;
			prev_trs[lagging_channel] = trs[lagging_channel];
			trs[lagging_channel] = ScanaStudio.trs_get_next(ch_list[lagging_channel]);
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
				binary_code = (gray_code);

				//Add dec item
				ScanaStudio.dec_item_new(ch_display,start_sample,trs[lagging_channel].sample_index);
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
				ScanaStudio.dec_item_end();

				if (file_handle >= 0)
				{
					append_new_line_to_file(start_sample/sampling_rate);
				}

				prev_binary_code = binary_code;
				break;
			}
			default: //we should never arrive here...
			state_machine = 0;
		}
	}

	if (file_handle >= 0)
	{
		ScanaStudio.file_system_close(file_handle);
	}
}

// GUI trigger
function on_draw_gui_trigger()
{
	ScanaStudio.gui_add_combo_box("my_combo","Select an option");
	ScanaStudio.gui_add_item_to_combo_box("Trig no matter what's the sense of rotation", true);
	ScanaStudio.gui_add_item_to_combo_box("Trig only on clockwise rotation", false);
	ScanaStudio.gui_add_item_to_combo_box("Trig only on counter-clockwise rotation", false);
	ScanaStudio.gui_add_new_selectable_containers_group("trig","Select the format of the data you want to trig on");
	ScanaStudio.gui_add_new_container("Trigger on a specific gray value", true);
	ScanaStudio.gui_add_text_input("gray_value","Gray value to trig on","");
	ScanaStudio.gui_add_info_label("The value entered will be converted in integer before traitment. The following table gives you an example of some value :");
	ScanaStudio.gui_end_container();
	ScanaStudio.gui_add_new_container("Trigger on a specific angle value", false);
	ScanaStudio.gui_add_text_input("angle_value","Angle value to trig on","");
	ScanaStudio.gui_add_info_label("Write a value between 0 and 360 degrees, no angle value in radian.");
	ScanaStudio.gui_end_container();
	ScanaStudio.gui_add_new_container("Trigger on a specific integer value", false);
	ScanaStudio.gui_add_text_input("integer_value","Integer value to trig on","");
	ScanaStudio.gui_add_info_label("Be careful ! If you use this option, you already know the waveform in graycode of the integer you want to trig on. You can use the following table :");
	ScanaStudio.gui_end_container();
	ScanaStudio.gui_end_selectable_containers_group()
	ScanaStudio.gui_add_info_label(""
	+ "Graycode base 2     Gray code base 10     integer base 10 \n"
	+ "     0  0  0  0                         0                            0        \n"
	+ "     0  0  0  1                         1                            1        \n"
	+ "     0  0  1  1                         2                            3        \n"
	+ "     0  0  1  0                         3                            2        \n"
	+ "     0  1  1  0                         4                            6        \n"
	+ "     0  1  1  1                         5                            7        \n"
	+ "     0  1  0  1                         6                            5        \n"
	+ "     0  1  0  0                         7                            4        \n"
	+ "     1  1  0  0                         8                           12       \n"
	+ "     1  1  0  1                         9                           13       \n"
	+ "     1  1  1  1                        10                          15       \n"
	+ "     1  1  1  0                        11                          14       \n"
	+ "     1  0  1  0                        12                          10       \n"
	+ "     1  0  1  1                        13                          11       \n"
	+ "     1  0  0  1                        14                           9        \n"
	+ "     1  0  0  0                        13                           8        ");
}

//Evaluate trigger GUI
function on_eval_gui_trigger()
{
	gray_value = ScanaStudio.gui_get_value("gray_value");
	angle_value = ScanaStudio.gui_get_value("angle_value");
	integer_value = ScanaStudio.gui_get_value("integer_value");

	if (isNaN(gray_value))
	{
		return "Please write only in gray code format";
	}
	if (isNaN(angle_value))
	{
		return "Please write a value between 0 and 360° ";
	}
	if (isNaN(integer_value))
	{
		return "Please write only an integer";
	}
	if (angle_value < 0 && angle_value > 360)
	{
		return "Please write a value between 0 and 360 degrees";
	}
	if (gray_value 	  > (Math.pow(2,ch_list.length)-1) ||
		integer_value > (Math.pow(2,ch_list.length)-1))
	{
		return "Be careful, there is not enough channel to code the value entered";
	}

	for (i = 0; i < ch_list.length; i++)
	{
		if ((gray_value >> (ch_list.length-i) && 0x01) != 0 ||
		(gray_value >> (ch_list.length-i) && 0x01) != 1)
		{
			return "Please write only 0 or 1";
		}
	}
	return ""; //All good.
}

function on_build_trigger()
{
	ch_list =  get_used_gray_channels_list();

	var trig = ScanaStudio.gui_get_value("trig");
	var rotation_sense = ScanaStudio.gui_get_value("my_combo");
	var pre_trig;
	var int_to_trig_on = 0;
	gray_type = ScanaStudio.gui_get_value("gray_type");
	rot_enc_ratio = ScanaStudio.gui_get_value("rot_enc_ratio");
	lin_enc_step = ScanaStudio.gui_get_value("lin_enc_step");
	gray_max_value = (Math.pow(2,ch_list.length)-1);

	if (gray_type == 0) //Rotary
	{
		increment_step = (360 / (gray_max_value+1)) * rot_enc_ratio;
	}
	else
	{
		increment_step = lin_enc_step;
	}


	if (trig == 0)//gray value
	{
		int_to_trig_on = gray_to_int(parseInt(ScanaStudio.gui_get_value("gray_value")));
	}
	else if (trig == 1)//angle value
	{
		int_to_trig_on = gray_to_int(parseInt(ScanaStudio.gui_get_value("angle_value")) / increment_step) ;
	}
	else//integer value
	{
		int_to_trig_on = parseInt(ScanaStudio.gui_get_value("integer_value"));
	}

	if (rotation_sense == 0)//no matter
	{

	}
	else if (rotation_sense == 1)//clockwise
	{
		pre_trig = gray_to_int(int_to_gray(int_to_trig_on) - 1);
		ScanaStudio.flexitrig_append(int_to_step(pre_trig), -1, -1);
	}
	else //counter-clockwise
	{
		pre_trig = gray_to_int(int_to_gray(int_to_trig_on) + 1);
		ScanaStudio.flexitrig_append(int_to_step(pre_trig), -1, -1);
	}

	ScanaStudio.flexitrig_append(int_to_step(int_to_trig_on), -1, -1);
	ScanaStudio.flexitrig_print_steps();
}

function int_to_step(int)//return a step composed of 0, 1 and X and with as much bit as the number of channel your device has
{
	var step = "";

	for (var i = 0; i < ScanaStudio.get_device_channels_count(); i++)
	{
		var is_ch_used = false;
		var temp_j = 0;
		for (var j = 0; j < ch_list.length; j++)
		{
			if (ch_list[j] == i)
			{
				is_ch_used = true;
				temp_j = j;
				break;
			}
		}
		if (is_ch_used)
		{
			var bit_val = (int>>(temp_j)) & 0x01;
			if (((int >> temp_j) & 0x01) == 0)// bit i du word
			{
				step = "0" + step;
			}
			else
			{
				step = "1" + step;
			}
		}
		else
		{
			step = "X" + step;
		}
	}
	return step;
}

//Helper functions (Inspired from silentmatt's code https://gist.github.com/silentmatt/136599)
function gray_to_int(gray)
{
	return gray ^ (gray >>> 1);
}

function int_to_gray(int)
{
	var g = int.toString(2).split("");
	var b = [];
	b[0] = g[0];
	for (var i = 1; i < g.length; i++) {
		b[i] = g[i] ^ b[i - 1];
	}
	return parseInt(b.join(""), 2);
}

//Decoder helper function
function is_all_last_trs()
{
	var last_trs = true;
	for (var i = 0; i < gray_bits_count; i++)
	{
		if (ScanaStudio.trs_is_not_last(ch_list[i])) //retun last_trs = true only if every channels have reached there last transition;
		{
			last_trs = false;
			break;
		}
	}
	return last_trs;
}

function get_lagging_channel()
{
	var lag_ch = 0;
	var lag_s = trs[0].sample_index;

	for (var i = 0; i < gray_bits_count; i++)
	{
		if( (trs[i].sample_index < lag_s) && (ScanaStudio.trs_is_not_last(ch_list[i])))
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

//Function called to generate demo signals (when no physical device is attached)
function on_build_demo_signals()
{
	//Use the function below to get the number of samples to be built
	var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
	var gray_builder = ScanaStudio.BuilderObject;
	sampling_rate = ScanaStudio.builder_get_sample_rate();
	ch_list = get_used_gray_channels_list();
	gray_builder.config(ch_list);
	gray_max_value = (Math.pow(2,ch_list.length)-1);

	var gray_code_counter = 0;
	var max_period = Math.floor(samples_to_build / (gray_max_value*0.75));
	if(max_period<100)
	{
		max_period = 100;
	}
	var min_period = Math.floor(max_period / 100);
	var period = Math.floor((max_period+min_period)/2);
	var step = min_period;

	while (ScanaStudio.builder_get_samples_acc(ch_list[0]) < samples_to_build)
	{

		if (ScanaStudio.abort_is_requested())
		{
			break;
		}

		period += step;
		if ((period >= max_period) || (period <= min_period))
		{
			step = -step;
		}
		gray_code_counter++;
		if (gray_code_counter > gray_max_value)
		{
			gray_code_counter = 0;
		}

		gray_builder.put_integer(gray_code_counter,period);
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

		var gray = int_to_gray(decimal_value);

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
