
/* Protocol meta info:
<NAME> UART </NAME>
<DESCRIPTION>
Serial UART (Universal asynchronous receiver/transmitter) Protocol Decoder.
</DESCRIPTION>
<VERSION> 1.50 </VERSION>
<AUTHOR_NAME>	Vladislav Kosinov, Ibrahim Kamal, Nicolas Bastit </AUTHOR_NAME>
<AUTHOR_URL> mailto:v.kosinov@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki/UART-ScanaStudio-script-documentation </HELP_URL>
<COPYRIGHT> Copyright 2019 Ikalogic SAS </COPYRIGHT>
<LICENSE>	This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V1.50: Added dec_item_end() for each dec_item_new().
V1.49: Fixed sampling points drawing
V1.48: Added trigger, added GUI validation
V1.47: Fixed freez condition.
V1.46: Fixed a bug that caused start bit to be drawn at the end of a capture
V1.45: Migrated this script to new V3 API.
V1.44: Improved demo signals builder performance
V1.43: Add light packet capabilities
V1.42: Fixed bug related to number of bits in demo signals builder
V1.41: Correted bug related to number of bits in signal generator
V1.40: Added ScanaStudio 2.3xx compatibility.
V1.39: Added Signal Generator capability
V1.38: Added ability to trigger on a phrase like "Hello World"
V1.37: Added definition of ASYNC mode (required by ScanaStudio V2.4).
V1.36: Added more decoder trigger functions
V1.35: Added decoder trigger functions
V1.34: Increased decoder's speed, specially for long captures
V1.33: Added support for demo signals generation
V1.32: Added channel information to the Packet View.
V1.31: Corrected bug related to partity bit in iverted data mode.
V1.30: Added to option to invert only data part of the signal (used for iso7816 communication).
V1.22: Corrected a bug related to the parity bit.
V1.20: Added Packet/Hex View support.
V1.17: Fixed bug with inverted logic. UI improvements.
V1.11: Added description and release notes
V1.10: Used the "bit_sampler" function for faster decoding
V1.00: Initial release
</RELEASE_NOTES>
*/

/*
Work in progress
================
still Todo:
* Test Trigger sequences
* Write documentation
* Sampling points
* Packet View
*/

//Decoder GUI
function on_draw_gui_decoder()
{
    var i;
    ScanaStudio.gui_add_ch_selector("ch","Channel to decode","UART");
    ScanaStudio.gui_add_baud_selector("baud","BAUD rate",9600);

    ScanaStudio.gui_add_new_tab("Output format",true);
    ScanaStudio.gui_add_check_box("format_hex","HEX",true);
    ScanaStudio.gui_add_check_box("format_ascii","ASCII",true);
    ScanaStudio.gui_add_check_box("format_dec","Unsigned decimal",false);
    ScanaStudio.gui_add_check_box("format_bin","Binary",false);
    ScanaStudio.gui_end_tab();

    ScanaStudio.gui_add_new_tab("Advanced options",false);
    ScanaStudio.gui_add_combo_box("nbits","Bits per transfer");
    for (i = 5; i < 17; i++)
    {
        if (i == 8)
        {
            ScanaStudio.gui_add_item_to_combo_box(i.toString(10),true);
        }
        else {
            ScanaStudio.gui_add_item_to_combo_box(i.toString(10),false);
        }
    }

    ScanaStudio.gui_add_combo_box("parity","Parity bit");
    ScanaStudio.gui_add_item_to_combo_box("No parity bit", true );
    ScanaStudio.gui_add_item_to_combo_box( "Odd parity bit", false );
    ScanaStudio.gui_add_item_to_combo_box( "Even parity bit", false );

    ScanaStudio.gui_add_combo_box( "stop", "Stop bits bit" );
    ScanaStudio.gui_add_item_to_combo_box( "1 stop bit", true );
    ScanaStudio.gui_add_item_to_combo_box( "1.5 stop bits" );
    ScanaStudio.gui_add_item_to_combo_box( "2 stop bits" );

    ScanaStudio.gui_add_combo_box( "order", "Bit order");
    ScanaStudio.gui_add_item_to_combo_box( "LSB First", true);
    ScanaStudio.gui_add_item_to_combo_box( "MSB First" );

    ScanaStudio.gui_add_combo_box( "invert", "Inverted logic" );
    ScanaStudio.gui_add_item_to_combo_box( "Non inverted logic (default)", true );
    ScanaStudio.gui_add_item_to_combo_box( "Inverted logic: All signals inverted" );
    ScanaStudio.gui_add_item_to_combo_box( "Inverted logic: Only data inverted" );
    ScanaStudio.gui_end_tab();
}

//Evaluate decoder GUI
function on_eval_gui_decoder()
{
    ScanaStudio.set_script_instance_name("UART on CH"+(ScanaStudio.gui_get_value("ch")+1).toString());
    if(Number(ScanaStudio.gui_get_value("baud")*8) >= (ScanaStudio.get_capture_sample_rate()) )
    {
        return "Selected bauderate is too high compared to the sampling rate you chose. Bauderate should be at least 8 times lower than the sampling rate.";
    }

    if(Number(ScanaStudio.gui_get_value("baud")) == 0)
    {
        return "Selected bauderate can't be null.";
    }

    return ""; //All good.
}

function reload_dec_gui_values()
{
    // read GUI values using ScanaStudio.gui_get_value("ID");
    channel =  Number(ScanaStudio.gui_get_value("ch"));
    baud = Number(ScanaStudio.gui_get_value("baud"));
    //nbits's 0 value corresponds to 5 bits per transfer
    nbits = Number(ScanaStudio.gui_get_value("nbits")) + 5;
    parity = Number(ScanaStudio.gui_get_value("parity"));
    //Stop value is 1, 1.5 or 2)
    stop = (Number(ScanaStudio.gui_get_value("stop"))*0.5) + 1;
    order =  Number(ScanaStudio.gui_get_value("order"));
    invert = Number(ScanaStudio.gui_get_value("invert"));
    format_hex = Number(ScanaStudio.gui_get_value("format_hex"));
    format_dec = Number(ScanaStudio.gui_get_value("format_dec"));
    format_ascii = Number(ScanaStudio.gui_get_value("format_ascii"));
    format_bin = Number(ScanaStudio.gui_get_value("format_bin"));
}

//Global variables
//GUI values
var channel,baud,nbits,parity,stop,order,invert;
var format_hex,format_bin,format_ascii,format_dec;
//Working variables
var sampling_rate;
var state_machine;
var start_bit_value,stop_bit_value;
var trs;
var cursor; //just a variable holding the sample_index of a virtual cursor
var samples_per_bit;
var margin;
var transfer_value; //Must be global

function on_decode_signals(resume)
{
    var bit_counter;
    var stop_bits_counter;
    var bit_value;
    var parity_value;

    var stop_bits_ok;
    if (!resume) //If resume == false, it's the first call to this function.
    {

        //initialization
        state_machine = 0;
        cursor = 1;
        sampling_rate = ScanaStudio.get_capture_sample_rate();
        reload_dec_gui_values();

        //Reset iterator
        ScanaStudio.trs_reset(channel);

        if (invert == 0)
        {
            start_bit_value = 0;
            stop_bit_value = 1;
        }
        else if (invert == 1)
        {
            start_bit_value = 1;
            stop_bit_value = 0;
        }
        else
        {
            start_bit_value = 0;
            stop_bit_value = 1;
        }

        samples_per_bit =  Math.floor(sampling_rate / baud);
        //ScanaStudio.console_info_msg("samples_per_bit = " + samples_per_bit);
        //Margin between decoder items
        margin = Math.floor(samples_per_bit / 20) + 1;
    }

    while (ScanaStudio.abort_is_requested() == false)
    {
        if (!ScanaStudio.trs_is_not_last(channel))
        {
            break;
        }
        //ScanaStudio.console_info_msg("state_machine = " + state_machine);
        switch (state_machine)
        {
            case 0: //Search for next start bit's edge
                trs = ScanaStudio.trs_get_next(channel);
                if ((trs.value == start_bit_value) && (trs.sample_index >= cursor)) //found!
                {
                    cursor = trs.sample_index;
                    state_machine++;
                }
                break;
            case 1:
                //wait until we have enough samples for the start bit
                if (ScanaStudio.get_available_samples(channel) > (cursor + samples_per_bit))
                {
                    //Add start bit item
                    ScanaStudio.dec_item_new(   channel,
                                                cursor + margin,
                                                cursor + samples_per_bit - margin);
                    ScanaStudio.dec_item_add_content("Start");
                    ScanaStudio.dec_item_add_content("S");
                    ScanaStudio.dec_item_end();

                    cursor += samples_per_bit; //Advance after start bit

                    ScanaStudio.bit_sampler_init(channel,cursor + (samples_per_bit*0.5),samples_per_bit);
                    if (invert > 0)
                    {
                        parity_value = 1;
                    }
                    else {
                        parity_value = 0;
                    }
                    transfer_value = 0;
                    state_machine++;

                    //ScanaStudio.console_info_msg("Start of data",cursor);
                }
                else {
                    //ScanaStudio.console_info_msg("Waiting for start bit",ScanaStudio.get_available_samples(channel));
                }
            case 2:
                //Wait until there is enough samples to capture a whole word
                if (ScanaStudio.get_available_samples(channel) > (cursor + (samples_per_bit * (nbits + 3))))
                {
                    //Add UART word
                    for (bit_counter = 0; bit_counter < nbits; bit_counter++)
                    {
                        bit_value = ScanaStudio.bit_sampler_next(channel);
                        if (invert > 0)
                        {
                            bit_value = bit_value ^ 1;
                        }
                        if (order == 0)
                        {
                            transfer_value += Math.pow(2, bit_counter) * bit_value;
                        }
                        else
                        {
                            transfer_value = (transfer_value * 2) + bit_value;
                        }
                        parity_value = parity_value ^ bit_value;
                    }
                    add_uart_dec_item(channel,cursor,transfer_value);

                    cursor += (nbits) * samples_per_bit; //advance after data field
                    //Add parity
                    if (parity > 0)
                    {
                        parity_value = parity_value ^ ScanaStudio.bit_sampler_next(channel);
                        ScanaStudio.dec_item_new( channel,
                            cursor + margin,
                            cursor + samples_per_bit - margin
                        );
                        if (((parity == 1 ) && (parity_value == 1))	||	((parity == 2 ) && (parity_value == 0))	)
                        {
                            ScanaStudio.dec_item_add_content("Parity OK");
                            ScanaStudio.dec_item_add_content("Par. OK");
                            ScanaStudio.dec_item_add_content("p.OK");
                            ScanaStudio.dec_item_add_content("p");
                        }
                        else
                        {
                            ScanaStudio.dec_item_add_content("Parity ERROR");
                            ScanaStudio.dec_item_add_content("Par. Err");
                            ScanaStudio.dec_item_add_content("Err");
                            ScanaStudio.dec_item_add_content("!");

                            ScanaStudio.dec_item_emphasize_error();
                        }

                        ScanaStudio.dec_item_end();
                        cursor += samples_per_bit;
                    }

                    //analyze stop bits
                    stop_bits_ok = true;
                    ScanaStudio.bit_sampler_init(channel,cursor,samples_per_bit*0.5);
                    for (stop_bits_counter = 0; stop_bits_counter < stop; stop_bits_counter+=0.5)
                    {
                        if (ScanaStudio.bit_sampler_next(channel) != stop_bit_value)
                        {
                            stop_bits_ok = false;
                        }
                    }

                    //Add stop bit
                    ScanaStudio.dec_item_new( channel,
                        cursor + margin,
                        cursor + (samples_per_bit * stop) - margin
                    );
                    if (stop_bits_ok)
                    {
                        ScanaStudio.dec_item_add_content("Stop");
                        ScanaStudio.dec_item_add_content("P");
                    }
                    else
                    {
                        ScanaStudio.dec_item_add_content("Stop bit Missing!");
                        ScanaStudio.dec_item_add_content("No Stop!");
                        ScanaStudio.dec_item_add_content("No P!");
                        ScanaStudio.dec_item_add_content("P!");

                        ScanaStudio.dec_item_emphasize_error(); //Ensure it stands out as an error!
                    }

                    ScanaStudio.dec_item_end();
                    cursor += ((samples_per_bit*stop)/2);
                    //ScanaStudio.console_info_msg("Cursor set",cursor);
                    state_machine = 0; //rewind to first state: wait for start bit.
                }
                else
                {
                    //ScanaStudio.console_info_msg("Waiting for data",ScanaStudio.get_available_samples(channel));
                }
                break;
            default:
                state_machine = 0;
            }

        //if we reach this point, it means there is no enough data to continue
        //(even if we may have not reached the last transition)
        //there is no sense to continue decoding.
        if (state_machine == 2)
        {
            break;
        }
    }
}

function add_uart_dec_item(ch, start_edge, value)
{
    var content,b;
    var prev_content = "";
    ScanaStudio.dec_item_new(ch,start_edge + margin,start_edge + (nbits * samples_per_bit) - margin);

    if (ScanaStudio.is_pre_decoding())
    {
        //in case tbis decoder is called by another decoder,
        //provide data in a way that can be easily interpreted
        //by the parent decoder.
        content = "0x" + pad(value.toString(16),Math.ceil(nbits/4));
        ScanaStudio.dec_item_add_content(content);
    }
    else
    {
        content = "";
        if (format_hex)
        {
            content += "0x" + pad(value.toString(16),Math.ceil(nbits/4));
        }
        if (format_ascii)
        {
            content += " '" + String.fromCharCode(value) + "'";
        }
        if (format_dec)
        {
            content += " (" + value.toString(10) + ")";
        }
        if (format_bin)
        {
            content += " 0b" + pad(value.toString(2),nbits) ;
        }
        ScanaStudio.dec_item_add_content(content);

        //Add a smaller version of the content field
        content = "";
        if  ((format_hex) && (content == ""))
        {
            content += "0x" + pad(value.toString(16),Math.ceil(nbits/4));
        }
        if ((format_ascii) && (content == ""))
        {
            content += " " + String.fromCharCode(value);
        }
        if ((format_dec) && (content == ""))
        {
            content += " " + value.toString(10) ;
        }
        if ((format_bin) && (content == ""))
        {
            content += " 0b" + pad(value.toString(2),nbits);
        }
        ScanaStudio.dec_item_add_content(content);
        //Add sample points
        for (b = 0; b < nbits; b++) //Start at 1 to skip start bit
        {
            ScanaStudio.dec_item_add_sample_point(start_edge + ((b+0.5) * samples_per_bit),"P");
        }
        
        if (value > 255) value = 255;
        if (value < 0) value = 255;

        ScanaStudio.hex_view_add_byte(ch,start_edge,start_edge + (nbits * samples_per_bit) ,value);
    }

    ScanaStudio.dec_item_end();
}

/*  A helper function add leading "0"s to numbers
Parameters
* num_str: A string of the number to be be 0-padded
* size: The total wanted size of the output string
*/
function pad(num_str, size) {
    while (num_str.length < size) num_str = "0" + num_str;
    return num_str;
}

//Trigger sequence GUI
function on_draw_gui_trigger()
{
    ScanaStudio.gui_add_new_selectable_containers_group("trig_alt","Select trigger type");
        ScanaStudio.gui_add_new_container("Trigger on any valid frame",true);
            ScanaStudio.gui_add_info_label("Trigger on any UART Frame. In other words,"+
            "this alternative will trigger on any start bit");
        ScanaStudio.gui_end_container();
        ScanaStudio.gui_add_new_container("Trigger on specific word",false);
            ScanaStudio.gui_add_info_label("Type decimal value (65), Hex value (0x41) or ASCII character ('A')");
            ScanaStudio.gui_add_text_input("trig_byte","Trigger word","");
        ScanaStudio.gui_end_container();
        ScanaStudio.gui_add_new_container("Trigger on a characters string",false);
            ScanaStudio.gui_add_info_label("Type a character string to be used for trigger. E.g.: Hello World");
            ScanaStudio.gui_add_text_input("trig_phrase","Trigger phrase","");
        ScanaStudio.gui_end_container();
    ScanaStudio.gui_end_selectable_containers_group();
}

//Evaluate trigger GUI
function on_eval_gui_trigger()
{
    trig_alt = ScanaStudio.gui_get_value("trig_alt");
    trig_byte = ScanaStudio.gui_get_value("trig_byte");

    if (trig_alt == 1)
    {
        if (trig_byte.length == 0)
        {
            return "Please specify trigger byte";
        }
        else if (isNaN(trig_byte))
        {
            if ((trig_byte.charAt(0) == "'") && (trig_byte.length < 3))
            {
                return "Invalid character";
            }
            if (trig_byte.length > 3)
            {
                return "Invalid trigger byte: Please enter only one character, e.g. 'a'";
            }
        }
    }
    return "" //All good.
}

function on_build_trigger()
{

    ScanaStudio.flexitrig_set_async_mode();
    reload_dec_gui_values();
    trig_alt = ScanaStudio.gui_get_value("trig_alt");
    trig_byte = ScanaStudio.gui_get_value("trig_byte");
    trig_phrase = ScanaStudio.gui_get_value("trig_phrase");

    var c = 0;
    var first_byte = true;
    var total_size = 0;

    if (trig_byte.charAt(0) == "'")
    {
        trig_byte = trig_byte.charCodeAt(1);
    }
    else
    {
        trig_byte = Number(trig_byte);
    }

    if (trig_alt == 0) //Trig on any byte
    {
        step = build_start_bit_step();
        ScanaStudio.flexitrig_append(step,-1, -1); 	// Start edge
    }
    else if (trig_alt == 1) // trig on byte
    {
        build_trig_byte(trig_byte,true);
    }
    else //trig on phrase
    {
        for (c = 0; c < trig_phrase.length; c++)
        {
            if (c == 0) first_byte = true;
            else first_byte = false;
            total_size += build_trig_byte(trig_phrase.charCodeAt(c),first_byte);
        }

        if (total_size > 63)
        {
            ScanaStudio.console_error_msg("Trigger phrase too large, please use less characters.");
        }
    }

    ScanaStudio.flexitrig_print_steps();
}

/*
*/
function build_trig_byte (new_byte, first)
{
    var lvl = [];
    var i;
    var total_steps = 0;
    var b;
    var par;
    var step;
    var bit_time = 1/baud;	// [s]
    var bt_max = bit_time * 1.15;	// Allow 15% margin on bit time <-- this may be configurable later.
    var bt_min = bit_time * 0.85;

    trig_bit_sequence = [];

    if (bt_max == bt_min)
    {
        if (bt_min > 0) bt_min--;
        else bt_max++;
    }

    switch (invert)	 // First, build trigger bit sequence
    {
        case 0:
        par = 0;
        lvl[1] = 1;
        lvl[0] = 0;
        trig_bit_sequence[0] = 0;
        break;

        case 1:
        par = 1;
        lvl[1] = 0;
        lvl[0] = 1;
        trig_bit_sequence[0] = 1;
        break;

        case 2:
        par = 1;
        lvl[1] = 0;
        lvl[0] = 1;
        trig_bit_sequence[0] = 0;
        break;
    }

    for (i = 0; i < nbits; i++)
    {
        if (order == 0) 	// LSB first
        {
            trig_bit_sequence.push(lvl[((new_byte >> i) & 0x1)]);
        }
        else
        {
            trig_bit_sequence.push(lvl[((new_byte >> nbits - i - 1) & 0x1)]);
        }

        par = par ^ lvl[((new_byte >> i) & 0x1)];
    }

    if (parity > 0)
    {
        switch(parity) //to be tested!
        {
            case 1: par = par ^ 1; break;
            case 2: par = par ^ 0; break;
        }

        trig_bit_sequence.push(par);
    }

    trig_bit_sequence.push((~trig_bit_sequence[0]) & 0x1);	// add stop bit

    step = build_step(0);	// Start bit

    if (first) 	// For the very first byte, ignore previous stop byte
    {
        ScanaStudio.flexitrig_append(step, -1, -1); 	// Start edge
    }
    else
    {
        ScanaStudio.flexitrig_append(step, bt_min*stop, -1); 	// Start edge have to be at least "n stop bits" way from the last transition.
    }

    var last_lvl = trig_bit_sequence[0];
    var last_index = 0;

    for (i = 1; i < trig_bit_sequence.length; i++)
    {
        if (trig_bit_sequence[i] != last_lvl)
        {
            last_lvl = trig_bit_sequence[i];
            step = build_step(i);
            ScanaStudio.flexitrig_append(step,bt_min*(i-last_index),bt_max*(i-last_index));
            last_index = i;
            total_steps ++;
        }
    }

    return total_steps;
}


/*
*/
function build_step (step_index)
{
    var step = "";
    var i;
    var step_ch_desc;

    if (trig_bit_sequence[step_index] == 0)
    {
        step_ch_desc = "F";
    }
    else
    {
        step_ch_desc = "R";
    }

    for (i = 0; i < ScanaStudio.get_device_channels_count(); i++)
    {
        if (i == channel)
        {
            step = step_ch_desc + step;
        }
        else
        {
            step = "X" + step;
        }
    }

    return step;
}


/*
*/
function build_start_bit_step()
{
    var step = "";
    var start_bit_desc;

    switch (invert)
    {
        case 0:
        case 2: start_bit_desc = "F"; break;
        case 1: start_bit_desc = "R"; break;
    }

    for (var i = 0; i < ScanaStudio.get_device_channels_count(); i++)
    {
        if (i == channel)
        {
            step = start_bit_desc + step;
        }
        else
        {
            step = "X" + step;
        }
    }

    return step;
}

//Function called to generate demo siganls (when no physical device is attached)
function on_build_demo_signals()
{
    var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
    var silence_period_samples = 1000 + (samples_to_build / 125);
    var uart_builder = ScanaStudio.BuilderObject;
    reload_dec_gui_values();
    uart_builder.config(
        Number(ScanaStudio.gui_get_value("ch")),
        Number(ScanaStudio.gui_get_value("baud")),
        Number(ScanaStudio.gui_get_value("nbits")),
        Number(ScanaStudio.gui_get_value("parity")),
        Number(ScanaStudio.gui_get_value("stop")),
        Number(ScanaStudio.gui_get_value("order")),
        Number(ScanaStudio.gui_get_value("invert")),
        Number(ScanaStudio.builder_get_sample_rate())
    );

    uart_builder.put_silence(10);
    uart_builder.put_str("Hello world, this is a test!");
    counter = 0;
    while(ScanaStudio.builder_get_samples_acc(channel) < samples_to_build)
    {
      if (ScanaStudio.abort_is_requested())
  		{
  			break;
  		}
      random_size = Math.floor(Math.random()*10) + 1;
      for (w = 0; w < random_size; w++)
      {
          uart_builder.put_c(counter);
          counter++;
          if (ScanaStudio.builder_get_samples_acc(channel) >= samples_to_build)
          {
              break;
          }
      }
      uart_builder.put_silence_samples(silence_period_samples);
    }
}

//Builder object that can be shared to other scripts
ScanaStudio.BuilderObject = {
    //to be configured by the user of this object using the setter functions below
    channel: 0,
    baud : 0,
    nbits : 0,
    parity : 0,
    stop : 0,
    order : 0,
    invert : 0,
    hi_level : 1,
    lo_level : 0,
    idle_level: 1,
    samples_per_bit: 10,

    put_str : function(str)
    {
        var i;
        for (i = 0; i < str.length; i++)
        {
            this.put_c(str.charCodeAt(i));
        }
    },
    put_c : function(code)
    {
        var i;
        var b;
        var lvl;
        var start,end,inc;
        var parity_value;

        //Add start bit
        ScanaStudio.builder_add_samples(this.channel, !this.idle_level, this.samples_per_bit);

        if (this.invert > 0) //if signals are inverted (1) or data only is inverted (2)
        {
            parity_value = 1;
        }
        else
        {
            parity_value = 0;
        }

        if (this.order == 1) 	// MSB first
        {
            for (i = this.nbits-1; i >= 0; i--)
            {
                b = ((code >> i) & 0x1);

                if (b == 1)
                {
                    lvl = this.hi_level;
                }
                else
                {
                    lvl = this.lo_level;
                }
                ScanaStudio.builder_add_samples(this.channel, lvl, this.samples_per_bit);
                parity_value = parity_value ^ lvl;
            }
        }
        else
        {
            for (i = 0; i < this.nbits; i++)
            {
                b = ((code >> i) & 0x1);

                if (b == 1)
                {
                    lvl = this.hi_level;
                }
                else
                {
                    lvl = this.lo_level;
                }
                ScanaStudio.builder_add_samples(this.channel, lvl, this.samples_per_bit);
                parity_value = parity_value ^ lvl;
            }
        }

        if (this.parity > 0)
        {
            switch (this.parity)
            {
                case 1: parity_value = parity_value ^ 1; break;
                case 2: parity_value = parity_value ^ 0; break;
            }
            ScanaStudio.builder_add_samples(this.channel, parity_value, this.samples_per_bit);
        }
        // Add stop bits
        ScanaStudio.builder_add_samples(this.channel, this.idle_level, this.stop * this.samples_per_bit);
    },

    put_silence : function(characters)
    {
        ScanaStudio.builder_add_samples(this.channel, this.idle_level, this.samples_per_bit*characters);
    },

    put_silence_samples : function(samples)
    {
        ScanaStudio.builder_add_samples(this.channel, this.idle_level, samples);
    },

    config : function(channel,baud,nbits,parity,stop,order,invert,sample_rate)
    {
        this.channel = channel;
        this.baud = baud;
        this.nbits = nbits + 5;
        this.parity = parity;
        this.stop = (stop*0.5) + 1; //stop is expressed in 0.5 bit increments
        this.order = order;
        this.invert = invert;

        if (invert == 0)
        {
            this.idle_level = 1;
            this.hi_level = 1;
            this.lo_level = 0;
        }
        else if (invert == 1)
        {
            this.idle_level = 0;
            this.hi_level = 0;
            this.lo_level = 1;
        }
        else
        {
            this.idle_level = 1;
            this.hi_level = 0;
            this.lo_level = 1;
        }
        this.samples_per_bit = Math.floor(sample_rate / baud);
    },
};
