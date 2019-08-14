/* Protocol meta info:
<NAME> SSI </NAME>
<DESCRIPTION>
Synchronous Serial Interface analyzer
</DESCRIPTION>
<VERSION> 0.2 </VERSION>
<AUTHOR_NAME>  Ibrahim Kamal </AUTHOR_NAME>
<AUTHOR_URL> i.kamal@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright Ibrahim Kamal </COPYRIGHT>
<LICENSE>  This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.2: Added dec_item_end() for each dec_item_new().
V0.1: Initial release.
</RELEASE_NOTES>
*/

/*
Todo
  * add pre_decoding support
*/

//Decoder GUI
function on_draw_gui_decoder()
{
  var i,s;
  //Define decoder configuration GUI
  ScanaStudio.gui_add_ch_selector("ch_clock","CLOCK line","CLOCK");
  ScanaStudio.gui_add_ch_selector("ch_data","DATA Line","DATA");
  ScanaStudio.gui_add_new_tab("Display options",false);
    ScanaStudio.gui_add_combo_box("data_format","Data display format");
      ScanaStudio.gui_add_item_to_combo_box("HEX",true);
      ScanaStudio.gui_add_item_to_combo_box("Binary",false);
      ScanaStudio.gui_add_item_to_combo_box("Decimal",false);
      ScanaStudio.gui_add_item_to_combo_box("ASCII",false);
  ScanaStudio.gui_end_tab();
  ScanaStudio.gui_add_new_tab("Advanced options",false);
    ScanaStudio.gui_add_engineering_form_input_box("tm","Transfer timeout (tm)",1e-6,100,"20e-6","s");
  ScanaStudio.gui_end_tab();
}

//Global variables
var sampling_rate;
var state_machine;
var trs_clock,trs_data,prev_trs_clock;
var bits,data_bit,word_value,bit_counter,min_pause_samples;
var last_clock_rising_edge, item_start_sample;
function on_decode_signals(resume)
{
  if (!resume) //If resume == false, it's the first call to this function.
  {
      //initialization code goes here, ex:
      state_machine = 0;
      sampling_rate = ScanaStudio.get_capture_sample_rate();
      get_gui_values(); //Load GUI values in global variables
      ScanaStudio.trs_reset(ch_data);
      ScanaStudio.trs_reset(ch_clock);
      trs_data = ScanaStudio.trs_get_next(ch_data);
      prev_trs_clock = ScanaStudio.trs_get_next(ch_clock);
      min_pause_samples = tm * sampling_rate;
      bit_counter = 0;
      bits = [];
      last_clock_rising_edge = 0;
  }

  while (ScanaStudio.abort_is_requested() == false)
  {
    if ((!ScanaStudio.trs_is_not_last(ch_data)) && (!ScanaStudio.trs_is_not_last(ch_clock)))
    {
      break;
    }

    switch (state_machine)
    {
      case 0: //detect clock falling edge
        trs_clock = ScanaStudio.trs_get_next(ch_clock);
        if (trs_clock.value == 0)
        {
          if ((trs_clock.sample_index - prev_trs_clock.sample_index) > min_pause_samples)
          {
            if (bit_counter > 1)
            {
              add_dec_item(item_start_sample,last_clock_rising_edge,word_value,bits);
              bit_counter = 0;
            }
          }
          prev_trs_clock = trs_clock;
          state_machine++;
          //ScanaStudio.console_info_msg("falling edge found",trs_clock.sample_index);
        }
        else
        {
          last_clock_rising_edge = trs_clock.sample_index;
        }
        break;
      case 1: //update data value
        //ScanaStudio.console_info_msg("updating data bit value",trs_data.sample_index);
        if (trs_data.sample_index <= trs_clock.sample_index)
        {
          data_bit = trs_data.value;
          trs_data = ScanaStudio.trs_get_next(ch_data);
        }
        else
        {
          state_machine++;
        }
        break;
      case 2: //get bit
        bit_counter++;
        if (bit_counter == 2) //Ignore first edge, as per specifications
        {
          item_start_sample = last_clock_rising_edge;
          word_value = 0;
          bits = [];
        }
        if (bit_counter > 1) //Ignore first edge, as per specifications
        {
          bits.push(trs_clock.sample_index);
          word_value = (word_value * 2) + data_bit;
        }
        state_machine = 0;
        break;
      default:
        state_machine = 0;
        break;
    }
  }
}

function add_dec_item(start_sample,end_sample,data,bits)
{
  ScanaStudio.dec_item_new(ch_data,start_sample,end_sample);
  ScanaStudio.dec_item_add_content(format_content(word_value,data_format,bits.length));
  var b;
  for (b = 0; b < bits.length; b++)
  {
    ScanaStudio.dec_item_add_sample_point(bits[b],"U");
  }
  if (bits.length > 53)
  {
    ScanaStudio.dec_item_emphasize_error();
    ScanaStudio.dec_item_end();
    ScanaStudio.console_error_msg("Maximum integer value reached, displayed results may not be correct.", start_sample);
  }
}

function get_gui_values()
{
  //put gui values in global variables
  ch_data = ScanaStudio.gui_get_value("ch_data");
  ch_clock = ScanaStudio.gui_get_value("ch_clock");
  tm = ScanaStudio.gui_get_value("tm");
  data_format = ScanaStudio.gui_get_value("data_format");
}

//Function called to generate demo siganls (when no physical device is attached)
function on_build_demo_signals()
{
  //Use the function below to get the number of samples to be built
  var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
  var silence_period = (samples_to_build / (125));
  var ssi_builder = ScanaStudio.BuilderObject;
  get_gui_values();

  while (ScanaStudio.builder_get_samples_acc(ch_clock) < samples_to_build)
  {
    var random_size = Math.floor(Math.random()*10) + 1;
    var data_array = [];
    var random_width = Math.floor(Math.random()*12) + 4;
    var max_value = ((1 << (random_width))-1);
    ssi_builder.config(ch_clock,ch_data,100e3,tm,random_width);
    var w;
    //ScanaStudio.console_info_msg("width="+random_width+", max_value="+max_value);
    for (w = 0; w < random_size; w++)
    {
      data_array.push(Math.round(Math.random()*max_value));
    }
    ssi_builder.put_silence(silence_period);
    ssi_builder.put_words(data_array);
  }
}

//Builder object that can be shared to other scripts
ScanaStudio.BuilderObject = {
  put_words : function(words)
  {
    var w;
    for (w = 0; w < words.length; w++)
    {
      this.put_word(words[w]);
      this.put_silence(this.tm_samples);
    }
  },
  put_word : function(w)
  {
    var b = 0;
    for (b = (this.n_bits-1); b >= 0; b--)
    {
      this.put_bit((w >> b) & 0x1);
    }
    this.put_bit(0); //Last bit is 0, always
  },
  put_silence : function(samples)
  {
    ScanaStudio.builder_add_samples(this.ch_clock,1,samples);
    ScanaStudio.builder_add_samples(this.ch_data,1,samples);
    this.last_data = this.last_clock = 1;
  },
  put_timeout : function()
  {
    ScanaStudio.builder_add_samples(this.ch_clock,1,this.tm_samples);
    ScanaStudio.builder_add_samples(this.ch_data,0,this.tm_samples);
    ScanaStudio.builder_add_samples(this.ch_clock,1,this.tm_samples);
    ScanaStudio.builder_add_samples(this.ch_data,1,this.tm_samples);
    this.last_data = this.last_clock = 1;
  },
  put_bit : function(b)
  {
    ScanaStudio.builder_add_samples(this.ch_clock,0,this.samples_per_half_clock);
    ScanaStudio.builder_add_samples(this.ch_data,this.last_data,this.samples_per_half_clock);

    this.last_data = b; //TODO remove "last_data", not needed
    ScanaStudio.builder_add_samples(this.ch_clock,1,this.samples_per_half_clock);
    ScanaStudio.builder_add_samples(this.ch_data,this.last_data,this.samples_per_half_clock);
  },
  config : function(ch_clock,ch_data,frequency,tm,n_bits)
  {
    this.ch_data = ch_data;
    this.ch_clock = ch_clock;
    this.last_data = 1;
    this.last_clock = 1;
    this.samples_per_half_clock = ScanaStudio.builder_get_sample_rate() / (frequency*2);
    this.tm_samples = tm * ScanaStudio.builder_get_sample_rate();
    this.n_bits = n_bits;
  }
};



/*
  Helper function to convert data to formated text
  according to formating options set by the user
*/
function format_content(data,data_format,size_bits)
{
  switch (data_format) {
    case 0: //HEX
      return "0x" + pad(data.toString(16),Math.ceil(size_bits/4));
      break;
    case 1: //Binary
      return to_binary_str(data,size_bits);
      break;
    case 2: // Dec
      return data.toString(10);
      break;
    case 3: //ASCII
      return " '" + String.fromCharCode(data) + "'"
      break;
    default:
  }
}

/* Helper fonction to convert value to binary, including 0-padding
  and groupping by 4-bits packets
*/
function to_binary_str(value, size)
{
  var i;
  var str = pad(value.toString(2),size);
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
function pad(num_str, size) {
    while (num_str.length < size) num_str = "0" + num_str;
    return num_str;
}
