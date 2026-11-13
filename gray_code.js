/* Protocol meta info:
<NAME> Gray Code </NAME>
<DESCRIPTION>
gray code support for ScanaStudio.
</DESCRIPTION>
<VERSION> 0.6 </VERSION>
<AUTHOR_NAME>	Juille Neil, Ibrahim KAMAL, Nicolas BASTIT	</AUTHOR_NAME>
<AUTHOR_URL> contact@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki/ </HELP_URL>
<COPYRIGHT> Copyright 2019 Ikalogic SAS </COPYRIGHT>
<LICENSE>	This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.6: Offers to configure the Gray code trigger once added (ScanaStudio v6).
V0.5: Decoding, demo, trigger and CSV fixed. Position, velocity and acceleration graphs.
V0.4: Fixed the on_build_demo_signals, on_decode_signals and added a trigger. Also added a table in the GUI in order to help users.
V0.3: Added dec_item_end() for each dec_item_new().
V0.2: Added CSV plotting option
V0.1: Initial release and create builder demo
</RELEASE_NOTES>
*/

var ENCODING = "UTF-8";
var DEFAULT_BITS = 4;

//Decoder GUI
function on_draw_gui_decoder()
{
	for (var i = 0; i < ScanaStudio.get_device_channels_count(); i++)
	{
		ScanaStudio.gui_add_combo_box("ch_b"+i.toString(),"Bit " + i.toString() + " Channel");
		ScanaStudio.gui_add_item_to_combo_box("Not used",i >= DEFAULT_BITS);
		for (var c = 0; c < ScanaStudio.get_device_channels_count(); c++)
		{
			if ((c==i) && (i < DEFAULT_BITS))
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

	ScanaStudio.gui_add_new_tab("Graphs",false);
	ScanaStudio.gui_add_info_label("Each graph is a virtual analog channel, with a point at each code change.");
	ScanaStudio.gui_add_check_box("display_position","Display the position (angle or distance)",true);
	ScanaStudio.gui_add_check_box("display_velocity","Display the velocity",false);
	ScanaStudio.gui_add_check_box("display_acceleration","Display the acceleration",false);
	ScanaStudio.gui_end_tab();

	ScanaStudio.gui_add_new_tab("CSV plotting options",false);
	ScanaStudio.gui_add_info_label("Select a file where decoded values should be saved, one line per code change."
		+ "\nClear this field if you don't want to save to file.");
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

	// ScanaStudio v6 offers to configure the Gray code trigger once the decoder is
	// added; v3 has no such call and would stop this eval on a TypeError.
	if (typeof ScanaStudio.ask_to_add_trigger === "function")
	{
		ScanaStudio.ask_to_add_trigger();
	}

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
var ch_list = [];
var ch_display;
var trs = [];
var trs_pending = [];
var levels = [];
var level_known = [];
var decoding_started;
var code_start;
var code_warning;
var gray_code;
var binary_code;
var gray_bits_count;
var gray_max_value;
var direction_text,direction_short_text,encoder_value_text;
var gray_type;
var increment_step;
var encoder_value;
var show_encoder_count;
var display_position, display_velocity, display_acceleration;
var file_handle;
var csv_enabled;
var write_file_position;
var write_file_velocity;
var write_file_acceleration;
var decimal_chr;
var rot_enc_ratio;
var lin_enc_step;
//Motion between code changes, in samples: velocity is an average over the last step, placed at its middle
var prev_change_time, prev_velocity_time; //samples
var velocity, acceleration, velocity_known, acceleration_known;

var VAC_POSITION = 0;
var VAC_VELOCITY = 1;
var VAC_ACCELERATION = 2;

function on_decode_signals(resume)
{
	if (!resume) //If resume == false, it's the first call to this function.
	{
		ch_list = get_used_gray_channels_list();
		gray_type = ScanaStudio.gui_get_value("gray_type");
		sampling_rate = ScanaStudio.get_capture_sample_rate();
		show_encoder_count = ScanaStudio.gui_get_value("show_encoder_count");
		display_position = ScanaStudio.gui_get_value("display_position");
		display_velocity = ScanaStudio.gui_get_value("display_velocity");
		display_acceleration = ScanaStudio.gui_get_value("display_acceleration");
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
		gray_bits_count = ch_list.length;
		gray_max_value = (Math.pow(2,ch_list.length)-1);

		if (gray_type == 0) //Rotary
		{
			increment_step = (360 / (gray_max_value+1)) * rot_enc_ratio;
		}
		else
		{
			increment_step = lin_enc_step;
		}

		ch_display = ch_list[0];

		trs = [];
		trs_pending = [];
		levels = [];
		level_known = [];
		for (var i = 0 ; i < gray_bits_count; i++)
		{
			trs.push(null);
			trs_pending.push(false);
			levels.push(0);
			level_known.push(false);
		}
		decoding_started = false;
		code_start = -1; //No item before the first code change

		prev_change_time = -1;
		prev_velocity_time = -1;
		velocity = 0;
		acceleration = 0;
		velocity_known = false;
		acceleration_known = false;

		create_vacs();

		csv_enabled = false;
		file_handle = ScanaStudio.file_system_open("csv_dest","w");
		if (file_handle >= 0)
		{
			csv_enabled = true;
			write_csv_header();
			ScanaStudio.file_system_close(file_handle);
		}
	}

	if (!decoding_started)
	{
		if (!read_initial_levels())
		{
			return; //Waits for more data
		}
		decoding_started = true;
		read_code();
		encoder_value = wrap_position(binary_code * increment_step); //An absolute encoder knows where it starts
		if (display_position)
		{
			ScanaStudio.vac_append_sample(VAC_POSITION, 0, encoder_value);
		}
	}

	file_handle = csv_enabled ? ScanaStudio.file_system_open("csv_dest","a") : -1;

	while (ScanaStudio.abort_is_requested() == false)
	{
		var change_sample = next_change_sample();
		if (change_sample < 0)
		{
			break; //Waits for more data
		}

		if (code_start >= 0)
		{
			add_code_item(code_start, change_sample);
		}

		//Transitions at the same sample make a single code change
		for (var i = 0; i < gray_bits_count; i++)
		{
			if (trs_pending[i] && (trs[i].sample_index == change_sample))
			{
				levels[i] = trs[i].value;
				trs_pending[i] = false;
			}
		}
		var prev_binary_code = binary_code;
		read_code();
		var steps = update_direction(prev_binary_code);
		update_motion(change_sample, steps);
		if (file_handle >= 0)
		{
			write_csv_line(change_sample/sampling_rate);
		}
		code_start = change_sample;
	}

	if (file_handle >= 0)
	{
		ScanaStudio.file_system_close(file_handle);
	}
}

//The transitions at sample 0 give a channel's initial level. A channel that holds no
//transition yet reads as a value that is neither 0 nor 1 (ScanaStudio 3): it is read again later.
//Returns true once every channel's initial level is known.
function read_initial_levels()
{
	var all_known = true;
	for (var i = 0; i < gray_bits_count; i++)
	{
		if (level_known[i])
		{
			continue;
		}
		ScanaStudio.trs_reset(ch_list[i]);
		trs[i] = ScanaStudio.trs_get_next(ch_list[i]);
		if ((trs[i].value != 0) && (trs[i].value != 1))
		{
			all_known = false;
			continue;
		}
		levels[i] = (trs[i].sample_index == 0) ? trs[i].value : 1 - trs[i].value;
		trs_pending[i] = (trs[i].sample_index > 0);
		while (!trs_pending[i] && ScanaStudio.trs_is_not_last(ch_list[i]))
		{
			trs[i] = ScanaStudio.trs_get_next(ch_list[i]);
			if (trs[i].sample_index == 0)
			{
				levels[i] = trs[i].value;
			}
			else
			{
				trs_pending[i] = true;
			}
		}
		level_known[i] = true;
	}
	return all_known;
}

//Sample of the earliest transition not decoded yet, or -1 when there is none (yet)
function next_change_sample()
{
	var first = -1;
	for (var i = 0; i < gray_bits_count; i++)
	{
		if (!trs_pending[i] && ScanaStudio.trs_is_not_last(ch_list[i]))
		{
			trs[i] = ScanaStudio.trs_get_next(ch_list[i]);
			trs_pending[i] = true;
		}
		if (trs_pending[i] && ((first < 0) || (trs[i].sample_index < first)))
		{
			first = trs[i].sample_index;
		}
	}
	return first;
}

function read_code()
{
	gray_code = 0;
	for (var i = 0; i < gray_bits_count; i++)
	{
		gray_code |= (levels[i] << i);
	}
	binary_code = gray_to_binary(gray_code);
}

//Returns the number of steps moved, the shortest way round when steps were skipped
function update_direction(prev_binary_code)
{
	var positions = gray_max_value + 1;
	var steps = (binary_code - prev_binary_code + positions) % positions;
	if (steps > positions / 2)
	{
		steps -= positions;
	}

	code_warning = false;
	if (steps == 1)
	{
		direction_text = " +";
		direction_short_text = "+";
	}
	else if (steps == -1)
	{
		direction_text = " -";
		direction_short_text = "-";
	}
	else //Steps were skipped
	{
		direction_text = " Direction ?";
		direction_short_text = " ";
		code_warning = true;
	}
	encoder_value = wrap_position(encoder_value + steps * increment_step);

	if (show_encoder_count == true)
	{
		encoder_value_text = " Count = " + format_position(encoder_value);
	}
	else
	{
		encoder_value_text = "";
	}
	return steps;
}

function wrap_position(value)
{
	if (gray_type == 0) //The angle wraps at 360°
	{
		value = value % 360;
		if (value < 0)
		{
			value += 360;
		}
	}
	return value;
}

function format_position(value)
{
	if (gray_type == 0)
	{
		//Enough decimals to tell two steps apart
		var decimals = Math.min(6, Math.max(1, Math.ceil(-Math.log(increment_step) / Math.LN10) + 2));
		return Number(value.toFixed(decimals)).toString() + "°";
	}
	return ScanaStudio.engineering_notation(value,3) + "m";
}

function update_motion(change_sample, steps)
{
	if (prev_change_time >= 0 && change_sample > prev_change_time)
	{
		var velocity_time = (prev_change_time + change_sample) / 2;
		var new_velocity = steps * increment_step * sampling_rate / (change_sample - prev_change_time);
		acceleration_known = velocity_known && (velocity_time > prev_velocity_time);
		if (acceleration_known)
		{
			acceleration = (new_velocity - velocity) * sampling_rate / (velocity_time - prev_velocity_time);
			if (display_acceleration)
			{
				ScanaStudio.vac_append_sample(VAC_ACCELERATION, Math.round((prev_velocity_time + velocity_time) / 2), acceleration);
			}
		}
		velocity = new_velocity;
		velocity_known = true;
		prev_velocity_time = velocity_time;
		if (display_velocity)
		{
			ScanaStudio.vac_append_sample(VAC_VELOCITY, Math.round(velocity_time), velocity);
		}
	}
	prev_change_time = change_sample;
	if (display_position)
	{
		ScanaStudio.vac_append_sample(VAC_POSITION, change_sample, encoder_value);
	}
}

function create_vacs()
{
	var unit = (gray_type == 0) ? "°" : "m";
	if (display_position)
	{
		ScanaStudio.vac_create_channel(VAC_POSITION, unit, "#118c8c", (gray_type == 0) ? "Angle" : "Position");
		ScanaStudio.vac_set_size(VAC_POSITION, 3);
	}
	else
	{
		ScanaStudio.vac_remove_channel(VAC_POSITION);
	}
	if (display_velocity)
	{
		ScanaStudio.vac_create_channel(VAC_VELOCITY, unit + "/s", "#8c6d11", "Velocity");
		ScanaStudio.vac_set_size(VAC_VELOCITY, 3);
	}
	else
	{
		ScanaStudio.vac_remove_channel(VAC_VELOCITY);
	}
	if (display_acceleration)
	{
		ScanaStudio.vac_create_channel(VAC_ACCELERATION, unit + "/s²", "#8c118c", "Acceleration");
		ScanaStudio.vac_set_size(VAC_ACCELERATION, 3);
	}
	else
	{
		ScanaStudio.vac_remove_channel(VAC_ACCELERATION);
	}
}

function add_code_item(start, end)
{
	ScanaStudio.dec_item_new(ch_display,start,end);
	if (code_warning)
	{
		ScanaStudio.dec_item_emphasize_warning();
	}
	ScanaStudio.dec_item_add_content(binary_code.toString(10) + direction_text + encoder_value_text);
	ScanaStudio.dec_item_add_content(binary_code.toString(10) + direction_text);
	ScanaStudio.dec_item_add_content(binary_code.toString(10) + direction_short_text);
	ScanaStudio.dec_item_end();
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
	ScanaStudio.gui_add_text_input("gray_value","Gray value to trig on","0");
	ScanaStudio.gui_add_info_label("Gray value: the position of the encoder, 0 being the first one.");
	ScanaStudio.gui_end_container();
	ScanaStudio.gui_add_new_container("Trigger on a specific angle value", false);
	ScanaStudio.gui_add_text_input("angle_value","Angle value to trig on","0");
	ScanaStudio.gui_add_info_label("Write a value between 0 and 360 degrees, no angle value in radian.");
	ScanaStudio.gui_end_container();
	ScanaStudio.gui_add_new_container("Trigger on a specific integer value", false);
	ScanaStudio.gui_add_text_input("integer_value","Integer value to trig on","0");
	ScanaStudio.gui_add_info_label("Integer value: the levels of the channels read as a binary number, bit 0 being the \"Bit 0\" channel.");
	ScanaStudio.gui_end_container();
	ScanaStudio.gui_end_selectable_containers_group()
	var table = "Example with 4 bits\nChannels (bit 3 to 0) : Gray value / Integer value";
	for (var position = 0; position < 16; position++)
	{
		var levels_value = binary_to_gray(position);
		var bits = "";
		for (var b = 3; b >= 0; b--)
		{
			bits += ((levels_value >> b) & 1).toString();
		}
		table += "\n" + bits + " : " + position.toString() + " / " + levels_value.toString();
	}
	ScanaStudio.gui_add_info_label(table);
}

//Evaluate trigger GUI
function on_eval_gui_trigger()
{
	ch_list = get_used_gray_channels_list();
	gray_max_value = (Math.pow(2,ch_list.length)-1);
	var trig = ScanaStudio.gui_get_value("trig");
	var value;

	if (trig == 0)
	{
		value = ScanaStudio.gui_get_value("gray_value");
	}
	else if (trig == 1)
	{
		value = ScanaStudio.gui_get_value("angle_value");
	}
	else
	{
		value = ScanaStudio.gui_get_value("integer_value");
	}

	if ((String(value).trim() == "") || isNaN(value))
	{
		return "Please write a number";
	}
	value = Number(value);
	if (trig == 1)
	{
		if ((value < 0) || (value > 360))
		{
			return "Please write a value between 0 and 360 degrees";
		}
	}
	else if ((value < 0) || (value > gray_max_value) || (Math.floor(value) != value))
	{
		return "Please write an integer between 0 and " + gray_max_value.toString() + " (" + ch_list.length.toString() + " bits)";
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

	//int_to_trig_on is the levels of the channels (the integer column of the table)
	if (trig == 0)//gray value
	{
		int_to_trig_on = binary_to_gray(parseInt(ScanaStudio.gui_get_value("gray_value")) & gray_max_value);
	}
	else if (trig == 1)//angle value
	{
		int_to_trig_on = binary_to_gray(Math.round(parseFloat(ScanaStudio.gui_get_value("angle_value")) / increment_step) & gray_max_value);
	}
	else//integer value
	{
		int_to_trig_on = parseInt(ScanaStudio.gui_get_value("integer_value")) & gray_max_value;
	}

	if (rotation_sense == 0)//no matter
	{

	}
	else if (rotation_sense == 1)//clockwise
	{
		pre_trig = binary_to_gray((gray_to_binary(int_to_trig_on) - 1) & gray_max_value);
		ScanaStudio.flexitrig_append(int_to_step(pre_trig), -1, -1);
	}
	else //counter-clockwise
	{
		pre_trig = binary_to_gray((gray_to_binary(int_to_trig_on) + 1) & gray_max_value);
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

function binary_to_gray(n)
{
	return n ^ (n >>> 1);
}

function gray_to_binary(gray)
{
	var binary = gray;
	for (var shift = gray >>> 1; shift != 0; shift >>>= 1)
	{
		binary ^= shift;
	}
	return binary;
}

//CSV: ";" separated, one line per code change, ASCII units so any spreadsheet reads them
function write_csv_header()
{
	var unit = (gray_type == 0) ? "deg" : "m";
	var columns = ["Time [s]", "Integer value", "Gray value"];
	if (write_file_position)
	{
		columns.push("Position [" + unit + "]");
	}
	if (write_file_velocity)
	{
		columns.push("Velocity [" + unit + "/s]");
	}
	if (write_file_acceleration)
	{
		columns.push("Acceleration [" + unit + "/s2]");
	}
	ScanaStudio.file_system_write_text(file_handle, columns.join(";") + "\n", ENCODING);
}

function write_csv_line(time_s)
{
	var columns = [csv_number(time_s), gray_code.toString(10), binary_code.toString(10)];
	if (write_file_position)
	{
		columns.push(csv_number(encoder_value));
	}
	if (write_file_velocity)
	{
		columns.push(velocity_known ? csv_number(velocity) : ""); //Unknown before the second code change
	}
	if (write_file_acceleration)
	{
		columns.push(acceleration_known ? csv_number(acceleration) : ""); //Unknown before the third code change
	}
	ScanaStudio.file_system_write_text(file_handle, columns.join(";") + "\n", ENCODING);
}

function csv_number(value)
{
	var parts = value.toPrecision(12).split("e");
	if (parts[0].indexOf(".") >= 0)
	{
		parts[0] = parts[0].replace(/\.?0+$/, ""); //Drops the trailing zeros
	}
	return parts.join("e").replace(".", decimal_chr);
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

	//Two full turns within the capture, the speed swinging by +/-50% around its mean
	var steps_count = 2 * (gray_max_value + 1);
	var mean_period = Math.max(2, Math.floor(samples_to_build * 0.95 / steps_count));
	var step_index = 0;

	while (ScanaStudio.builder_get_samples_acc(ch_list[0]) < samples_to_build)
	{
		if (ScanaStudio.abort_is_requested())
		{
			break;
		}

		var period = Math.max(1, Math.round(mean_period * (1 + 0.5 * Math.sin(2 * Math.PI * step_index / steps_count))));
		gray_builder.put_integer(step_index & gray_max_value, period);
		step_index++;
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

		var gray = decimal_value ^ (decimal_value >>> 1);

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
