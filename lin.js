/* Protocol meta info:
<NAME> LIN Bus </NAME>
<DESCRIPTION>
LIN (Local Interconnect Network) protocol analyzer
</DESCRIPTION>
<VERSION> 0.5 </VERSION>
<AUTHOR_NAME>  Ibrahim KAMAL, Vladislav Kosinov </AUTHOR_NAME>
<AUTHOR_URL> i.kamal@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright Ibrahim KAMAL, Vladislav Kosinov </COPYRIGHT>
<LICENSE>  This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.5: Added hex and packet views
V0.3: Added dec_item_end() for each dec_item_new()
V0.2: Added decoder GUI validation function
V0.1: Initial release
</RELEASE_NOTES>
*/

/*
  Todo in future releases
  -----------------------
  * Add trigger generator support
  * Add online documentation
  * Add signal builder support
*/

var FRAME_ID =
{
	CONFIG_0   : 0x3C,
	CONFIG_1   : 0x3D,
	RESERVED_0 : 0x3E,
	RESERVED_1 : 0x3F
};

var ID_FIELD_MASK =
{
	PARITY   : 0xC0,
	PARITY_0 : 0x40,
	PARITY_1 : 0x80,
	ID       : 0x3F
};

//Decoder GUI
function on_draw_gui_decoder()
{
  	//Define decoder configuration GUI
  	ScanaStudio.gui_add_ch_selector("ch_lin","LIN bus ch_lin","LIN");

	ScanaStudio.gui_add_new_tab("Advanced options",false);
	ScanaStudio.gui_add_combo_box("lin_spec","LIN Specifications version");
	    ScanaStudio.gui_add_item_to_combo_box("LIN V1.x",false);
	  	ScanaStudio.gui_add_item_to_combo_box("LIN V2.x",true);
	ScanaStudio.gui_add_combo_box("id_format","ID display format");
	  	ScanaStudio.gui_add_item_to_combo_box("HEX",true);
	  	ScanaStudio.gui_add_item_to_combo_box("Binary",false);
	  	ScanaStudio.gui_add_item_to_combo_box("Decimal",false);
	ScanaStudio.gui_add_combo_box("parity_format","Parity display format");
	  	ScanaStudio.gui_add_item_to_combo_box("HEX",false);
	  	ScanaStudio.gui_add_item_to_combo_box("Binary",true);
	  	ScanaStudio.gui_add_item_to_combo_box("Decimal",false);
	ScanaStudio.gui_add_combo_box("data_format","Data display format");
	  	ScanaStudio.gui_add_item_to_combo_box("HEX",true);
	  	ScanaStudio.gui_add_item_to_combo_box("Binary",false);
	  	ScanaStudio.gui_add_item_to_combo_box("Decimal",false);
	ScanaStudio.gui_end_tab();
}

//Evaluate decoder GUI
function on_eval_gui_decoder()
{
  ch_lin = ScanaStudio.gui_get_value("ch_lin");
  ScanaStudio.set_script_instance_name("LIN on Ch: " + (ch_lin+1).toString());
  return "" //All good.
}

//Global variables
var sampling_rate;
var state_machine;
var chksum_bytes = [];
var finished = false;

function on_decode_signals (resume)
{
	if (!resume) //If resume == false, it's the first call to this function.
	{
		//initialization code goes here, ex:
		state_machine = 0;
		sampling_rate = ScanaStudio.get_capture_sample_rate();
		// read GUI values using ScanaStudio.gui_get_value("ID");
		ch_lin = ScanaStudio.gui_get_value("ch_lin");
		lin_spec = ScanaStudio.gui_get_value("lin_spec");
		id_format = ScanaStudio.gui_get_value("id_format");
		parity_format = ScanaStudio.gui_get_value("parity_format");
		data_format = ScanaStudio.gui_get_value("data_format");
		cursor = 1;
		break_width = 0;
		bit_counter = 0;
		n_lin_bytes = 0;
		byte_counter = 0;
		last_sync_bit_width = 0;
		first_sync_edge = 0;
		sync_bit_width = 0;
		samples_per_bit = 0;
		min_break_width = 11*sampling_rate/(20e3);//11 bits @ 20KBAUD, expressed in samples
		chksum_bytes = [];
		ScanaStudio.trs_reset(ch_lin);
	}

	while (ScanaStudio.trs_is_not_last(ch_lin))
	{
		if ((ScanaStudio.abort_is_requested() == true) || finished)
		{
			return;
		}

		switch (state_machine)
		{
		    case 0: //Seach for break falling edge
			    trs = ScanaStudio.trs_get_next(ch_lin);

				if ((trs.value == 0) && (trs.sample_index >= cursor)) //found!
			    {
			    	cursor = trs.sample_index;
			      	state_machine++;
			    }
			break;

			case 1: //search for end of break;
			    break_start = cursor;
			    trs = ScanaStudio.trs_get_next(ch_lin);

				if ((trs.value == 1) && (trs.sample_index >= cursor)) //found!
			    {
					break_width = trs.sample_index - cursor;
					cursor = trs.sample_index;

					ScanaStudio.packet_view_add_packet(true, ch_lin, break_start, -1, "LIN", "CH" + (ch_lin + 1), ScanaStudio.get_channel_color(ch_lin), ScanaStudio.get_channel_color(ch_lin));

					if (break_width > min_break_width)
					{
						ScanaStudio.dec_item_new(ch_lin, break_start, cursor);
						ScanaStudio.dec_item_add_content("BREAK");
						ScanaStudio.dec_item_add_content("BRK");
						ScanaStudio.dec_item_add_content("B");
						ScanaStudio.dec_item_end();
						ScanaStudio.packet_view_add_packet(false, ch_lin, break_start, cursor, "Break", "", "#FF66CC", "#FF99CC");

						bit_counter = 0;
						state_machine++;
					}
					else
					{
						//invalid break
						ScanaStudio.dec_item_new(ch_lin,break_start,cursor);
						ScanaStudio.dec_item_add_content("INVALID BREAK (too short)");
						ScanaStudio.dec_item_add_content("INVALID BREAK");
						ScanaStudio.dec_item_add_content("! BREAK");
						ScanaStudio.dec_item_add_content("!");
						ScanaStudio.dec_item_emphasize_error();
						ScanaStudio.dec_item_end();
						ScanaStudio.packet_view_add_packet(false, ch_lin, break_start, cursor, "Invalid Break", "", "#FF0000", "#FF8080");

						//ScanaStudio.console_info_msg("Invalid break",cursor);
						state_machine = 0;
					}
			    }
			break;

			case 2: //Search for sync bits
				trs = ScanaStudio.trs_get_next(ch_lin);
			    last_sync_bit_width = sync_bit_width;
			    sync_bit_width = trs.sample_index - cursor;
			    cursor = trs.sample_index;

				//ScanaStudio.console_info_msg("bit_counter="+bit_counter,cursor);
			    if (bit_counter == 0)
			    {
			    	first_sync_edge = cursor;
			    }
			    else if (bit_counter == 1)
			    {
			      	sync_start = cursor;
			    }
			    else if (bit_counter == 9)
			    {
			      	sync_end = cursor;
			    }

				bit_counter++;

				if ((bit_counter > 2) && ((Math.abs(last_sync_bit_width - sync_bit_width) / sync_bit_width) > 0.2)) //More than 20% variation
			    {
					//It's not valid SYNC field
					ScanaStudio.dec_item_new(ch_lin, first_sync_edge, cursor);
					ScanaStudio.dec_item_add_content("INVALID SYNC");
					ScanaStudio.dec_item_add_content("! SYNC");
					ScanaStudio.dec_item_add_content("!");
					ScanaStudio.dec_item_emphasize_error();
					ScanaStudio.dec_item_end();
					ScanaStudio.packet_view_add_packet(false, ch_lin, first_sync_edge, cursor, "Invalid Sync", "", "#FF0000", "#FF8080");
					//ScanaStudio.console_info_msg("Ivalid sync filed:"+last_sync_bit_width+"/"+sync_bit_width,cursor);
					state_machine = 0;
			    }
			    else if ((bit_counter > 1) && (sync_bit_width > (break_width * 0.20)))
			    {
					ScanaStudio.dec_item_new(ch_lin, first_sync_edge, cursor);
					ScanaStudio.dec_item_add_content("INVALID SYNC");
					ScanaStudio.dec_item_add_content("! SYNC");
					ScanaStudio.dec_item_add_content("!");
					ScanaStudio.dec_item_emphasize_error();
					ScanaStudio.dec_item_end();
					ScanaStudio.packet_view_add_packet(false, ch_lin, first_sync_edge, cursor, "Invalid Sync", "", "#FF0000", "#FF8080");

					// ScanaStudio.console_info_msg("Ivalid sync filed(2):"+sync_bit_width+"/"+break_width,cursor);
					state_machine = 0;
			    }
			    else if (bit_counter >= 11)
			    {
					// Calculate baud rate as the average bit time in the sync field
					samples_per_bit = Math.floor((cursor - first_sync_edge) / 10);
					var baud = Math.floor(sampling_rate / samples_per_bit);

					ScanaStudio.dec_item_new(ch_lin, first_sync_edge, sync_start);
					ScanaStudio.dec_item_add_content("START");
					ScanaStudio.dec_item_add_content("S");
					ScanaStudio.dec_item_end();

					ScanaStudio.dec_item_new(ch_lin, sync_start, sync_end);
					ScanaStudio.dec_item_add_content("SYNC Field (BAUD = " + baud.toString() + ")");
					ScanaStudio.dec_item_add_content("SYNC");
					ScanaStudio.dec_item_add_content("S");
					ScanaStudio.dec_item_end();
					ScanaStudio.packet_view_add_packet(false, ch_lin, sync_start, sync_end, "Sync", baud.toString() + " baud(s)", "#FF9966", "#FFCC66");

					ScanaStudio.dec_item_new(ch_lin, sync_end, cursor);
					ScanaStudio.dec_item_add_content("STOP");
					ScanaStudio.dec_item_add_content("P");
					ScanaStudio.dec_item_end();

					//ScanaStudio.console_info_msg("Sync ok, baud = " + baud);
					ScanaStudio.bit_sampler_init(ch_lin, cursor + (samples_per_bit * 0.5), samples_per_bit);
					chksum_bytes = [];
					state_machine++;
			    }
			break;

			case 3: //get PID field
			    if (ScanaStudio.get_available_samples(ch_lin) > (cursor + (samples_per_bit * 13)))
			    {
					//Get Start bit
					lin_start = ScanaStudio.bit_sampler_next(ch_lin);
					//get 6-bit ID
					lin_id = 0;

					for (bit_counter = 0; bit_counter < 6; bit_counter++)
					{
						bit_value = ScanaStudio.bit_sampler_next(ch_lin);
						lin_id += Math.pow(2, bit_counter) * bit_value;
					}

					//ScanaStudio.console_info_msg("ID = " + lin_id.toString(16),cursor);
					//Get 2-bit parity
					lin_par = 0;

					for (bit_counter = 0; bit_counter < 2; bit_counter++)
					{
						bit_value = ScanaStudio.bit_sampler_next(ch_lin);
						lin_par += Math.pow(2, bit_counter) * bit_value;
					}

					//ScanaStudio.console_info_msg("PAR = 0b " + lin_par.toString(2),cursor);
					chksum_bytes.push((lin_id | (lin_par << 6)));
					//Get stop bit
					lin_stop = ScanaStudio.bit_sampler_next(ch_lin);

					if (lin_stop == 0)
					{
						//ScanaStudio.console_info_msg("This is probably a BREAK (during ID)...",cursor);
						//This is probably a BREAK.
						state_machine = 1;
					}
					else
					{
						ScanaStudio.dec_item_new(ch_lin, cursor, cursor + samples_per_bit);

						if (lin_start == 0)
						{
							ScanaStudio.dec_item_add_content("START");
							ScanaStudio.dec_item_add_content("S");
						}
						else
						{
							ScanaStudio.dec_item_add_content("! INVALID START");
							ScanaStudio.dec_item_add_content("! S");
							ScanaStudio.dec_item_add_content("!");
							ScanaStudio.dec_item_emphasize_error();
							ScanaStudio.packet_view_add_packet(false, ch_lin, cursor, cursor + samples_per_bit, "Invalid Start", "", "#FF0000", "#FF8080");
						}

						ScanaStudio.dec_item_end();

						ScanaStudio.dec_item_new(ch_lin, cursor + (samples_per_bit * 1), cursor + (samples_per_bit * 7));
						ScanaStudio.dec_item_add_content("ID = " + format_content(lin_id, id_format, 6) + " Data LEN = " + get_lin_data_len(lin_id));
						ScanaStudio.dec_item_add_content("ID = " + format_content(lin_id, id_format, 6) + " L = " + get_lin_data_len(lin_id));
						ScanaStudio.dec_item_add_content("ID = " + format_content(lin_id, id_format, 6));
						ScanaStudio.dec_item_add_content(format_content(lin_id, id_format, 6));
						ScanaStudio.dec_item_end();

						ScanaStudio.packet_view_add_packet(false, ch_lin, cursor + (samples_per_bit * 1), cursor + (samples_per_bit * 7), "ID", format_content(lin_id, id_format, 6), "#FF9966", "#FFCC66");
						ScanaStudio.packet_view_add_packet(false, ch_lin, cursor + (samples_per_bit * 1), cursor + (samples_per_bit * 7), "Data Length", get_lin_data_len(lin_id), "#FF9966", "#FFCC66");

						ScanaStudio.dec_item_new(ch_lin, cursor + (samples_per_bit * 7), cursor + (samples_per_bit * 9));
						ScanaStudio.dec_item_add_content("Parity = " + format_content(lin_par, parity_format, 2));
						ScanaStudio.dec_item_add_content("P = " + format_content(lin_par, parity_format, 2));
						ScanaStudio.dec_item_add_content(format_content(lin_par, parity_format, 2));
						ScanaStudio.dec_item_end();
						ScanaStudio.packet_view_add_packet(false, ch_lin, cursor + (samples_per_bit * 7), cursor + (samples_per_bit * 9), "Parity", format_content(lin_par, parity_format, 2), "#FF9966", "#FFCC66");

						ScanaStudio.dec_item_new(ch_lin, cursor + (samples_per_bit * 9), cursor + (samples_per_bit * 10));

						if (lin_stop == 1)
						{
							ScanaStudio.dec_item_add_content("STOP");
							ScanaStudio.dec_item_add_content("S");
						}
						else
						{
							ScanaStudio.dec_item_add_content("! STOP MISSING");
							ScanaStudio.dec_item_add_content("! S");
							ScanaStudio.dec_item_add_content("!");
							ScanaStudio.dec_item_emphasize_error();
							ScanaStudio.packet_view_add_packet(false, ch_lin, cursor + (samples_per_bit * 9), cursor + (samples_per_bit * 10), "Missing Stop", "", "#FF0000", "#FF8080");
						}

						ScanaStudio.dec_item_end();
						n_lin_bytes = get_lin_data_len(lin_id);
						byte_counter = 0;
						cursor += samples_per_bit * 9.5;
						state_machine++;
				    }
			    }
			    else
			    {
			    	finished = true;
			    }
			break;

			case 4: //Reading 1 byte: Wait for start bit
			    trs = ScanaStudio.trs_get_next(ch_lin);

				if ((trs.value == 0) && (trs.sample_index >= cursor)) //found!
			    {
					cursor = trs.sample_index;
					ScanaStudio.bit_sampler_init(ch_lin,cursor+(samples_per_bit * 0.5),samples_per_bit);
					state_machine++;
					//ScanaStudio.console_info_msg("Data "+byte_counter+"/"+n_lin_bytes,cursor);
			    }
			break;

			case 5: //Reading 1 byte: gather the bits and ensure it's not a break;
				if (ScanaStudio.get_available_samples(ch_lin) > (cursor + (samples_per_bit * 13)))
				{
					//Get Start bit
					lin_start = ScanaStudio.bit_sampler_next(ch_lin);
					//get 8 data bits
					lin_data = 0;

					for (bit_counter = 0; bit_counter < 8; bit_counter++)
					{
						bit_value = ScanaStudio.bit_sampler_next(ch_lin);
						lin_data += Math.pow(2, bit_counter) * bit_value;
					}

					lin_stop = ScanaStudio.bit_sampler_next(ch_lin);

					if (lin_stop == 0)
					{
						//ScanaStudio.console_info_msg("This is probably a BREAK (during data)...",cursor);
						//This is probably a BREAK.
						state_machine = 1;
					}
					else
					{
						ScanaStudio.dec_item_new(ch_lin, cursor, cursor + samples_per_bit);

						if (lin_start == 0)
						{
							ScanaStudio.dec_item_add_content("START");
							ScanaStudio.dec_item_add_content("S");
						}
						else
						{
							ScanaStudio.dec_item_add_content("! INVALID START");
							ScanaStudio.dec_item_add_content("! S");
							ScanaStudio.dec_item_add_content("!");
							ScanaStudio.dec_item_emphasize_error();
							ScanaStudio.packet_view_add_packet(false, ch_lin, cursor, cursor + samples_per_bit, "Invalid Start", "", "#FF0000", "#FF8080");
						}

						ScanaStudio.dec_item_end();

						if (byte_counter < n_lin_bytes)
						{
							//ScanaStudio.console_info_msg("push to cheksum: " + lin_data);
							chksum_bytes.push(lin_data);
							ScanaStudio.dec_item_new(ch_lin, cursor + (samples_per_bit * 1), cursor + (samples_per_bit * 9));
							ScanaStudio.dec_item_add_content("DATA("+ byte_counter.toString(10) +") = " + format_content(lin_data, data_format, 8));
							ScanaStudio.dec_item_add_content("DATA = " + format_content(lin_data, data_format, 8));
							ScanaStudio.dec_item_add_content(format_content(lin_data, data_format, 8));
							ScanaStudio.dec_item_end();

							ScanaStudio.packet_view_add_packet(false, ch_lin, cursor + (samples_per_bit * 1), cursor + (samples_per_bit * 9), "Data", format_content(lin_data, data_format, 8), "#33FFFF", "#99FFFF");
							ScanaStudio.hex_view_add_byte(ch_lin, cursor + (samples_per_bit * 1), cursor + (samples_per_bit * 9), lin_data);
						}
						else
						{
							var chksum = checksum_calc(chksum_bytes, lin_spec);
							ScanaStudio.dec_item_new(ch_lin, cursor + (samples_per_bit * 1), cursor + (samples_per_bit * 9));

							if (chksum == lin_data)
							{
								ScanaStudio.dec_item_add_content("CHECKSUM = " + format_content(lin_data, data_format, 8) + " OK");
								ScanaStudio.dec_item_add_content(format_content(lin_data, data_format, 8) + " OK");
								ScanaStudio.dec_item_add_content(format_content(lin_data, data_format, 8));
								ScanaStudio.packet_view_add_packet(false, ch_lin, cursor + (samples_per_bit * 1), cursor + (samples_per_bit * 9), "Checksum", format_content(lin_data, data_format, 8) + " OK", "#33FF66", "#66FF99");
							}
							else
							{
								ScanaStudio.dec_item_add_content("CHECKSUM = " + format_content(lin_data, data_format, 8) + " INVALID! Should be = " + format_content(chksum, data_format, 8));
								ScanaStudio.dec_item_add_content("Err! " + format_content(lin_data, data_format, 8) + " (" +  format_content(chksum, data_format, 8) + ")");
								ScanaStudio.dec_item_add_content("! " + format_content(lin_data, data_format, 8));
								ScanaStudio.dec_item_add_content("!");
								ScanaStudio.dec_item_emphasize_error();
								ScanaStudio.packet_view_add_packet(false, ch_lin, cursor + (samples_per_bit * 1), cursor + (samples_per_bit * 9), "Invalid Checksum", format_content(chksum, data_format, 8), "#FF0000", "#FF8080")
							}

							ScanaStudio.dec_item_end();
						}

						ScanaStudio.dec_item_new(ch_lin, cursor + (samples_per_bit * 9), cursor + (samples_per_bit * 10));

						if (lin_stop == 1)
						{
							ScanaStudio.dec_item_add_content("STOP");
							ScanaStudio.dec_item_add_content("S");
						}
						else
						{
							ScanaStudio.dec_item_add_content("! STOP MISSING");
							ScanaStudio.dec_item_add_content("! S");
							ScanaStudio.dec_item_add_content("!");
							ScanaStudio.dec_item_emphasize_error();
							ScanaStudio.packet_view_add_packet(false, ch_lin, cursor + (samples_per_bit * 9), cursor + (samples_per_bit * 10), "Missing Stop", "", "#FF0000", "#FF8080");
						}

						ScanaStudio.dec_item_end();
						cursor += samples_per_bit * 9.5;

						if (byte_counter < n_lin_bytes)
						{
							byte_counter++;
							state_machine--;
						}
						else
						{
							state_machine = 0; //search for next break;
						}
					}
				}
				else
				{
					finished = true;
				}
			break;

			default:
			    state_machine = 0;
			break;
		}
	}
}

//Function called to generate demo siganls (when no physical device is attached)
function on_build_demo_signals()
{
	//Use the function below to get the number of samples to be built
	var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
	var silence_period_samples = 1000 + (samples_to_build / 125);
	ch_lin = ScanaStudio.gui_get_value("ch_lin");
	lin_spec = ScanaStudio.gui_get_value("lin_spec");
	var builder = ScanaStudio.BuilderObject;
	builder.config(ch_lin,9600,lin_spec);

	while (ScanaStudio.builder_get_samples_acc(ch_lin) < samples_to_build)
	{
		builder.put_silence(silence_period_samples);
		var random_id = Math.floor(Math.random()*63);
		var len = get_lin_data_len(random_id);
		var i;
		var data = []

		for (i = 0; i<len; i++)
		{
			data.push(Math.floor(Math.random()*255));
		}

		builder.put_frame(random_id,data);
	}
}

//Builder object that can be shared to other scripts
ScanaStudio.BuilderObject =
{
	//to be configured by the user of this object using the setter functions below
	ch_lin: 0,
	sampling_rate: 1e6,

	put_silence : function (samples_count)
	{
		ScanaStudio.builder_add_samples(this.ch_lin, 1, samples_count);
	},

	put_frame : function (id, data_bytes)
	{
		var lin_frame = [];
		var i;

		lin_frame.push(id | (calc_parity(id) << 6));
		this.put_header(id);

		for (i = 0; i < data_bytes.length; i++)
		{
			lin_frame.push(data_bytes[i]);
		  	this.put_byte(data_bytes[i]);
		}

		this.put_byte(checksum_calc(lin_frame, this.spec));
	},

	put_header : function (id)
	{
		var parity;

		//13 break bits
		ScanaStudio.builder_add_samples(this.ch_lin, 0, 13 * this.samples_per_bit);
		ScanaStudio.builder_add_samples(this.ch_lin, 1, 4 * this.samples_per_bit);
		this.put_byte(0x55);

		//Put ID field
		//Start bit
		ScanaStudio.builder_add_samples(this.ch_lin, 0, this.samples_per_bit);

		for (i = 0; i < 6; i++)
		{
			b = ((id >> i) & 0x1)
			ScanaStudio.builder_add_samples(this.ch_lin, b, this.samples_per_bit);
		}

		//Put parity bits
		parity = calc_parity(id);

		for (i = 0; i < 2; i++)
		{
			b = ((parity >> i) & 0x1)
			ScanaStudio.builder_add_samples(this.ch_lin, b, this.samples_per_bit);
		}

		//Stop bit
		ScanaStudio.builder_add_samples(this.ch_lin,1,this.samples_per_bit);
	},

	put_byte : function (byte)
	{
		var i, b;

		//Start bit
		ScanaStudio.builder_add_samples(this.ch_lin, 0, this.samples_per_bit);

		for (i = 0; i < 8; i++)
		{
			b = ((byte >> i) & 0x1)
			ScanaStudio.builder_add_samples(this.ch_lin, b, this.samples_per_bit);
		}

		//Stop bit
		ScanaStudio.builder_add_samples(this.ch_lin,1,this.samples_per_bit);
	},

	config : function (ch, baud, spec)
	{
		this.ch_lin = ch;
		this.spec = spec;
		this.samples_per_bit = Math.floor(ScanaStudio.builder_get_sample_rate() / baud);
	}
};

//Helper functions below

/* Get the checksum of all data bytes (array should include PID byte)
*/
/*
  Spec: 0 for lin 1.x, 1 for lin 2.x
  Test pattern: 0x3C 0xBB 0XE9 should return 0x1E.
*/
function checksum_calc (lin_cheksumed_bytes, spec)
{
	var i;
	var chksum = 0;

	for (i = 0; i < lin_cheksumed_bytes.length; i++)
	{
		if ((i == 0) && (spec > 0))
		{
			var id = (lin_cheksumed_bytes[0] & ID_FIELD_MASK.ID);

			// Config frame identifiers shall always use classic checksum w/o id field
			if ((id != FRAME_ID.CONFIG_0) && (id != FRAME_ID.CONFIG_1))
			{
				//ScanaStudio.console_info_msg("cheksumming ID byte");
				chksum += lin_cheksumed_bytes[i];
				//ScanaStudio.console_info_msg("chksum calc step("+ i +"), data= 0x"+lin_cheksumed_bytes[i].toString(16));
			}
			else
			{
				//ScanaStudio.console_info_msg("ignoring ID byte from cheksum");
			}
		}
		else if (i > 0)
		{
			//ScanaStudio.console_info_msg("chksum calc step("+ i +"), data= 0x"+lin_cheksumed_bytes[i].toString(16));
			chksum += lin_cheksumed_bytes[i];
		}

		if (chksum >= 256) chksum -= 255;
		//ScanaStudio.console_info_msg("SUM = 0x"+chksum.toString(16));
	}

	//ScanaStudio.console_info_msg("chksum before invert="+chksum);
	return (~chksum) & 0xFF;
}


function calc_parity (id)
{
	var id0 = (id & 0x01) ? 1 : 0;
	var id1 = (id & 0x02) ? 1 : 0;
	var id2 = (id & 0x04) ? 1 : 0;
	var id3 = (id & 0x08) ? 1 : 0;
	var id4 = (id & 0x10) ? 1 : 0;
	var id5 = (id & 0x20) ? 1 : 0;

	var p0Calc = (id0 ^ id1 ^ id2  ^ id4);	// XOR of bits ID0, ID1, ID2 and ID4
	var p1Calc = !(id1 ^ id3 ^ id4 ^ id5);  // NOT of XOR of bits ID1, ID3, ID4 and ID5
	//ScanaStudio.console_info_msg("PArity for " + id + " = " + p0Calc + ":" + p1Calc);
	return (p0Calc | (p1Calc << 1));
}


/* Verify parity of frame identifier bits
*/
function check_parity (id)
{
	var id0 = (id & 0x01) ? 1 : 0;
	var id1 = (id & 0x02) ? 1 : 0;
	var id2 = (id & 0x04) ? 1 : 0;
	var id3 = (id & 0x08) ? 1 : 0;
	var id4 = (id & 0x10) ? 1 : 0;
	var id5 = (id & 0x20) ? 1 : 0;

	var p0 = (id & ID_FIELD_MASK.PARITY_0) ? 1 : 0;
	var p1 = (id & ID_FIELD_MASK.PARITY_1) ? 1 : 0;

	var p0Calc = (id0 ^ id1 ^ id2  ^ id4);	// XOR of bits ID0, ID1, ID2 and ID4
	var p1Calc = !(id1 ^ id3 ^ id4 ^ id5);  // NOT of XOR of bits ID1, ID3, ID4 and ID5

	if ((p0 == p0Calc) && (p1 == p1Calc))
	{
		return true;
	}

	return false;
}

function get_lin_data_len (id)
{
	if (lin_spec == 0)
	{
		return 8;
	}
	else if (id < 0x20)
	{
		return 2;
	}
	else if (id < 0x30)
	{
		return 4;
	}
	else
	{
		return 8;
	}
}

/*
  Helper function to convert data to formated text
  according to formating options set by the user
*/
function format_content (data, data_format, size_bits)
{
	switch (data_format)
	{
		case 0: //HEX
		return "0x" + pad(data.toString(16), Math.ceil(size_bits / 4));
		break;

		case 1: //Binary
		return to_binary_str(data, size_bits);
		break;

		case 2: // Dec
		return data.toString(10);
		break;

		case 3: //ASCII
		return " '" + String.fromCharCode(data) + "'"
		break;

		default: break;
	}
}

/* Helper fonction to convert value to binary, including 0-padding
  and groupping by 4-bits packets
*/
function to_binary_str (value, size)
{
	var i;
	var str = pad(value.toString(2), size);
	var ret = "";

	for (i = 0; i < str.length; i+= 4)
	{
		ret += str.slice(i,(i+4)) + " ";
	}

	ret = "0b" + ret + str.slice(i);
	return ret;
}

/*  A helper function add leading "0"s to numbers
      Parameters
        * num_str: A string of the number to be be 0-padded
        * size: The total wanted size of the output string
*/
function pad (num_str, size)
{
    while (num_str.length < size) num_str = "0" + num_str;
    return num_str;
}
