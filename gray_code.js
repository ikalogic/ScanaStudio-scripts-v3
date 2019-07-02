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
	V1.0: Initial release & create builder demo
	V1.1: Decode signial
</RELEASE_NOTES>
*/

/*
TODO
~~~~
* Trigger
* Add options to display: [speed, acceleration, position]
* PLOT to CSV
*/

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

	ScanaStudio.gui_add_new_selectable_containers_group("gray_type","Gray encoder type");
		ScanaStudio.gui_add_new_container("Rotary encoder",true);
			ScanaStudio.gui_add_info_label("Angle per step is automatically detected using the number of bits");
		ScanaStudio.gui_end_container();
		ScanaStudio.gui_add_new_container("Linear encoder",false);
			ScanaStudio.gui_add_engineering_form_input_box("lin_enc_step","Linear encoder step",1e-9,1,"1e-6","m");
		ScanaStudio.gui_end_container();
	ScanaStudio.gui_end_selectable_containers_group();
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
var direction_text,direction_short_text;

function on_decode_signals(resume)
{

  if (!resume) //If resume == false, it's the first call to this function.
  {
      state_machine = 0;
			ch_list = get_used_gray_channels_list();
      sampling_rate = ScanaStudio.get_capture_sample_rate();
			trs = [];
			start_sample = 0;
			lagging_channel = 0;
			lagging_sample = 0;
			prev_binary_code = -1;
			gray_bits_count = ch_list.length;
			gray_max_value = (Math.pow(2,ch_list.length)-1);

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
					if (prev_binary_code == -1)
					{
						direction_text = " Direction ?"; //unknown direction (yet)
						direction_short_text = " "; //unknown direction (yet)
					}
					else if (((prev_binary_code + 1) & gray_max_value) == binary_code)
					{
						direction_text = " Incr.";
						direction_short_text = "+";
					}
					else if (((prev_binary_code - 1) & gray_max_value) == binary_code)
					{
						direction_text = " Decr.";
						direction_short_text = "-";
					}

					ScanaStudio.dec_item_add_content(binary_code.toString(10) + direction_text);
					ScanaStudio.dec_item_add_content(binary_code.toString(10) + direction_short_text);

					prev_binary_code = binary_code;

					break;
				}
      default: //we should nevel arrive here...
				state_machine = 0;
    }
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


//Function called to generate demo siganls (when no physical device is attached)
function on_build_demo_signals()
{
	//Use the function below to get the number of samples to be built
	var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
	var gray_builder = ScanaStudio.BuilderObject;
	sampling_rate = ScanaStudio.builder_get_sample_rate();
	var ch_list = get_used_gray_channels_list();

	/*
		Variables to generate demo gray code where speed and direction
		varies according to a sine wave (10 periods per capture)
	*/

	var gray_moduleation_f = sampling_rate/(samples_to_build/10);
	var samples_per_min_period = 1000;
	var gray_carrier_f_max = sampling_rate / samples_per_min_period;
	var gray_carrier_f_min = sampling_rate / (samples_per_min_period*10);
	gray_max_value = Math.pow(2,ch_list.length) - 1;
	var angle = 0;
	var angle_increment = (2 * Math.PI) * samples_per_min_period / samples_to_build;
	var gray_code_counter = 0;

	// ScanaStudio.console_info_msg("samples_per_min_period="+samples_per_min_period);
	// ScanaStudio.console_info_msg("gray_carrier_f_max="+gray_carrier_f_max);
	// ScanaStudio.console_info_msg("gray_carrier_f_min="+gray_carrier_f_min);
	// ScanaStudio.console_info_msg("gray_max_value="+gray_max_value);
	// var freq = gray_carrier_f_min + ((Math.sin(angle)+1)*gray_carrier_f_max/2) ;
	// ScanaStudio.console_info_msg("freq="+freq);

	gray_builder.config(ch_list);


	while (ScanaStudio.builder_get_samples_acc(ch_list[0]) < samples_to_build)
	{
		if (ScanaStudio.abort_is_requested())
		{
			break;
		}
		var freq = gray_carrier_f_min + ((Math.sin(angle)+1)*gray_carrier_f_max/2) ;
		var period = sampling_rate / Math.abs(freq);
		//ScanaStudio.console_info_msg("freq="+freq+", code = "+gray_code_counter);
		gray_builder.put_integer(gray_code_counter,period);
		if (freq > (gray_carrier_f_min + (gray_carrier_f_max/2)))
		{
			gray_code_counter++;
		}
		else
		{
			gray_code_counter--;
		}
		if (gray_code_counter >= gray_max_value)
		{

			gray_code_counter = 0;
		}
		if (gray_code_counter < 0)
		{
			gray_code_counter = gray_max_value;
		}
		angle += (2 * Math.PI) * period / samples_to_build;
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
  config : function(ch_gray,period)
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
