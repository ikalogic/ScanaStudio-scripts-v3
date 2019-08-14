/* Protocol meta info:
<NAME> I2S </NAME>
<DESCRIPTION>
I2S Digital audio signals decoders
</DESCRIPTION>
<VERSION> 0.2 </VERSION>
<AUTHOR_NAME>  Ibrahim KAMAL, Vladislav Kosinov </AUTHOR_NAME>
<AUTHOR_URL> v.kosinov@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki/I2S-decoder-documentation </HELP_URL>
<COPYRIGHT> Copyright Ibrahim KAMAL, Vladislav Kosinov </COPYRIGHT>
<LICENSE>  This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.2: Added dec_item_end() for each dec_item_new().
V0.1: Initial release.
</RELEASE_NOTES>
*/

/*
Future evoluations
~~~~~~~~~~~~~~~~~~
* Add trigger support
* Add export support
* Add documentation
*/

//Decoder GUI
function on_draw_gui_decoder()
{
  ScanaStudio.gui_add_ch_selector("ch_sd", "(SD) Serial Data", "SD");
	ScanaStudio.gui_add_ch_selector("ch_sck", "(SCK) Serial Clock", "SCK");
	ScanaStudio.gui_add_ch_selector("ch_ws", "(WS) Word Select", "WS");
  ScanaStudio.gui_add_info_label("The number of bits per word is automatically detected from the signals, and may be variable from word to word.");
  ScanaStudio.gui_add_combo_box("format","Display format");
  ScanaStudio.gui_add_item_to_combo_box("Signed decimal",true);
  ScanaStudio.gui_add_item_to_combo_box("HEX",false);
  ScanaStudio.gui_add_item_to_combo_box("Binary",false);
}


//Global variables
var WS_RIGHT = 1;
var WS_LEFT = 0;
var sampling_rate;
var state_machine;
var next_trs_ws;

function on_decode_signals(resume)
{
  if (!resume) //If resume == false, it's the first call to this function.
  {
      //initialization code goes here, ex:
      state_machine = 0;
      sampling_rate = ScanaStudio.get_capture_sample_rate();
      ch_sd = ScanaStudio.gui_get_value("ch_sd");
      ch_sck = ScanaStudio.gui_get_value("ch_sck");
      ch_ws = ScanaStudio.gui_get_value("ch_ws");
      format = ScanaStudio.gui_get_value("format");
      switch (format) {
        case 0:
          format = 10; //dec
          break;
        case 1:
          format = 16; //Hex
          break;
        case 2:
          format = 2; //bin
          break;
        default:
      }

      ScanaStudio.trs_reset(ch_sd);
      ScanaStudio.trs_reset(ch_sck);
      ScanaStudio.trs_reset(ch_ws);

      clock_sample_points = [];
      bit_counter = -1;
      sd_word = 0;
      sd_word_signed = 0;
      next_bit_is_lsb = false;
      word_start_sample = -1;
      next_trs_ws = null;

  }

  while (ScanaStudio.abort_is_requested() == false)
  {
    if (!ScanaStudio.trs_is_not_last(ch_ws)) break;
    if (!ScanaStudio.trs_is_not_last(ch_sck)) break;
    switch (state_machine)
    {
      case 0: //search for next WS transition
        trs_ws = next_trs_ws;
        next_trs_ws = ScanaStudio.trs_get_next(ch_ws);
        if (trs_ws == null) break; //if very first time
        if (trs_ws.sample_index <= 0) break;
        trs_sd = ScanaStudio.trs_get_before(ch_sd,trs_ws.sample_index);
        trs_sck = ScanaStudio.trs_get_before(ch_sck,trs_ws.sample_index);
        sd_bit = trs_sd.value;
        state_machine++;
        break;
      case 1: //fetch next clock edge
        //ScanaStudio.console_info_msg("SM1:"+trs_sck.sample_index+"/"+trs_ws.sample_index);
        trs_sck = ScanaStudio.trs_get_next(ch_sck);
        if (trs_sck.sample_index < trs_ws.sample_index)
        {

          break;
        }

        if (trs_sck.value == 1)
        {
          if (bit_counter == 0) word_start_sample = trs_sck.sample_index;
          if (bit_counter >= 0) clock_sample_points.push(trs_sck.sample_index);
          state_machine++;
        }

        if (trs_sck.sample_index > next_trs_ws.sample_index)
        {
          //ScanaStudio.console_info_msg("trs_clk.sample_index > cs_end_sample");
          next_bit_is_lsb = true;
          state_machine = 0;
        }
        break;
      case 2: //update SD bit value
        if (trs_sd.sample_index <= trs_sck.sample_index) //If needed, advance SD transition iterator
        {
          //ScanaStudio.console_info_msg("mosi_bit="+trs_mosi.value);
          sd_bit = trs_sd.value;
          trs_sd = ScanaStudio.trs_get_next(ch_sd);
        }
        else {
          state_machine++;
        }
        break;
      case 3: //accumulate data word bits
        if (bit_counter >= 0)
        {
          if ((bit_counter == 0) && (sd_bit==1))
          {
            sd_word = 0xFFFFFFFF;
          }
          sd_word = (sd_word << 1) + sd_bit;
          //ScanaStudio.console_info_msg("bit_counter = "+bit_counter+"/"+sd_word);
        }
        state_machine = 1; //fetch next bit
        bit_counter++;

        if (next_bit_is_lsb) //reached end of the word
        {

          if (word_start_sample > 0) //if not very first (premature) word
          {
            var margin = 0.5 * (trs_sck.sample_index - word_start_sample) / bit_counter;
            ScanaStudio.dec_item_new(ch_sd,word_start_sample-margin,trs_sck.sample_index+margin);
            sd_word_signed = sd_word;
            if (next_trs_ws.value == WS_RIGHT)
            {
              //sd_word = (sd_word;
              ScanaStudio.dec_item_add_content("RIGHT: " + sd_word_signed.toString(format));
              ScanaStudio.dec_item_add_content("R: " + sd_word_signed.toString(format));
            }
            else {
              ScanaStudio.dec_item_add_content("LEFT: " + sd_word_signed.toString(format));
              ScanaStudio.dec_item_add_content("L: " + sd_word_signed.toString(format));
            }
            ScanaStudio.dec_item_add_content(sd_word_signed.toString(format));
            var b;
            for (b = 0; b < clock_sample_points.length; b++)
            {
              ScanaStudio.dec_item_add_sample_point(clock_sample_points[b],"U");
            }
          }

          ScanaStudio.dec_item_end();
          bit_counter = 0;
          sd_word = 0;
          clock_sample_points = [];
        }
        next_bit_is_lsb = false;
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
  var i2s_builder = ScanaStudio.BuilderObject;
  var ch_sck = ScanaStudio.gui_get_value("ch_sck");
  i2s_builder.config(
    ScanaStudio.gui_get_value("ch_sd"),
    ScanaStudio.gui_get_value("ch_sck"),
    ScanaStudio.gui_get_value("ch_ws"),
    24,
    ScanaStudio.builder_get_sample_rate(),
    22.05e3);

  //generate nice 1KHz sine wave, At 22.05KSPS
  var a = 0;
  var angle_increment = (Math.PI * 2)/(22.05);
  var amp = 1e3;
  var audio;
  var cnt = 0;
  while (ScanaStudio.builder_get_samples_acc(ch_sck) < samples_to_build)
  {
    audio = Math.sin(a) * amp;
    i2s_builder.put_stereo(audio,audio);
    a += angle_increment;
    if (a > Math.PT*2) a -= Math.PT*2;
    if (ScanaStudio.abort_is_requested())
    {
      break;
    }
    //I2S signal generation can be slow, so limit the number of words in demo mode.
    if (cnt++ > 5000) break;
  }
}


//Builder object that can be shared to other scripts
ScanaStudio.BuilderObject = {

  put_stereo : function (wr, wl)
  {
    this.last_ws = WS_RIGHT;
    this.put_word(wr);
    this.last_ws = WS_LEFT;
    this.put_word(wl);
  },
  put_word : function(word)
  {
    var i;
    var b_sd;
    this.put_bit(this.last_sd_lsb);
    this.last_sd_lsb = word & 0x1;
    word = word >> 1;
    for (i = 0; i < this.nbits; i++)
    {
      b_sd = ((word >> (this.nbits - i -1)) & 0x1);
      this.put_bit(b_sd);
    }
  },
  put_bit : function(b_sd)
  {
  	this.put_half_bit(b_sd,0);
    this.put_half_bit(b_sd,1);
  },
  put_half_bit : function(b_sd,clk)
  {
    ScanaStudio.builder_add_samples(this.ch_sd, b_sd, this.samples_per_half_clock);
    ScanaStudio.builder_add_samples(this.ch_sck, clk, this.samples_per_half_clock);
    ScanaStudio.builder_add_samples(this.ch_ws, this.last_ws, this.samples_per_half_clock);
  },
  config : function(ch_sd,ch_sck,ch_ws,nbits,sample_rate,audio_sample_rate)
  {
    this.ch_sd = ch_sd;
    this.ch_sck = ch_sck;
    this.ch_ws = ch_ws;
    this.nbits = nbits-1;
    this.sample_rate = sample_rate;
    this.samples_per_half_clock = (sample_rate / ((audio_sample_rate*nbits*2)*2));
    this.last_sd_lsb = 0;
  }
};
