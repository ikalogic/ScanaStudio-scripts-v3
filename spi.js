/* Script meta info:
<NAME> SPI </NAME>
<DESCRIPTION>
Highly configurable SPI bus decoder
</DESCRIPTION>
<VERSION> 1.72 </VERSION>
<AUTHOR_NAME>  Vladislav Kosinov, Ibrahim Kamal </AUTHOR_NAME>
<AUTHOR_URL> mailto:v.kosinov@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki/SPI-script-documentation </HELP_URL>
<COPYRIGHT> Copyright IKALOGIC SAS 2019 </COPYRIGHT>
<LICENSE>  This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
  V1.72: Migrated to new V3 API
  V1.71: Fix bug that caused decodering to fail if CS is ignored.
	V1.70: Fix decoding issue with missing CS signal at the start
	V1.69: Fix PacketView packets search iisue
	V1.68: Fix the last byte/word not being decoded
	V1.67: BugFix: Decoding stops after an invalid frame engineering_notation(
  ,digits)
	V1.66: Add light packet capabilities
	V1.65: Completely reworked PacketView
	V1.62: Better progress reporting, better demo mode generator, better PacketView
	V1.61: Upgrade PacketView
	V1.60: Fixed bug in SPI decoder and improve display
	V1.59: Fixed bug in SPI decoder when CS is not valide
	V1.58: Fixed bug in SPI generator, thanks to user Camille
	V1.57: Added ScanaStudio 2.3xx compatibility.
	V1.56: Added generator capability
	V1.55: New options for trigger part
	V1.54: Trigger fix
	V1.53: Added decoder trigger
	V1.52: Added demo signal building capability
	V1.50: Better handling of probable noize on CS line (e.g. during system power up)
	V1.49: Enhanced the way hex data is displayed in packet view (Thanks to user 0xdeadbeef)
	V1.48: Corrected a bug in the way decoded data is displayed
	V1.47: Better drawing of decoded items on the wavefrom (better alignment).
	V1.46: Fixed a bug that caused some SPI modes to be incorrectly decoded. (By I.Kamal)
	V1.45: Corrected another bug related to the option to ignore CS line. (By I.Kamal)
	V1.44: Corrected a bug related to the option to ignore CS line. (By I.Kamal)
	V1.42: Added the ability to ignore the CS line (for 2 wire SPI mode)
	V1.41: Added the ability to decode even if the first CS edge is missing
	V1.30: Added Packet/Hex View support.
	V1.26: Added the possibility (option) to ignore MOSI or MISO line
	V1.25: Single slave (w/o a cs signal) mode bug fixes. Thx to DCM
	V1.20: UI improvements
	V1.15: CPOL=1 & CPHA=1 mode bug fixes
	V1.10: Some little bug fixes
	V1.01: Added description and release notes
	V1.00: Initial release
</RELEASE_NOTES>
*/

/*
  Work in progress
  ================
    * Add option to display CLK average frequency
    * Add hex view and packet view support
    * Add support for trigger
    * add sample points
    * Update online documentation
*/

//Decoder GUI
function on_draw_gui_decoder()
{
  ScanaStudio.gui_add_ch_selector( "ch_mosi", "MOSI (Master Out) Line", "MOSI" );
	ScanaStudio.gui_add_ch_selector( "ch_miso", "MISO (Slave Out) Line", "MISO" );
	ScanaStudio.gui_add_ch_selector( "ch_clk", "CLOCK Line", "SCLK" );
	ScanaStudio.gui_add_ch_selector( "ch_cs", "Chip Select (Slave select)", "CS" );
  ScanaStudio.gui_add_combo_box( "bit_order", "Bit Order" );
		ScanaStudio.gui_add_item_to_combo_box( "Most significant bit first (MSB)", true );
		ScanaStudio.gui_add_item_to_combo_box( "Least significant bit first (LSB)" );

  ScanaStudio.gui_add_new_tab("spi_mode_tab","SPI Mode configuration",false);
    ScanaStudio.gui_add_combo_box( "cpol", "Clock polarity" );
  		ScanaStudio.gui_add_item_to_combo_box( "(CPOL = 0) clock LOW when inactive", true );
  		ScanaStudio.gui_add_item_to_combo_box( "(CPOL = 1) Clock HIGH when inactive" );
  	ScanaStudio.gui_add_combo_box( "cpha", "Clock phase" );
  		ScanaStudio.gui_add_item_to_combo_box( "(CPHA = 0) Data samples on leading edge", true );
  		ScanaStudio.gui_add_item_to_combo_box( "(CPHA = 1) Data samples on trailing edge" );
  ScanaStudio.gui_end_tab();

  ScanaStudio.gui_add_new_tab("format_tab","Output format",false);
    ScanaStudio.gui_add_check_box("format_hex","HEX",true);
    ScanaStudio.gui_add_check_box("format_ascii","ASCII",false);
    ScanaStudio.gui_add_check_box("format_dec","Unsigned decimal",false);
    ScanaStudio.gui_add_check_box("format_bin","Binary",false);
  ScanaStudio.gui_end_tab();

  ScanaStudio.gui_add_new_tab("advanced_tab","Advanced options",false);
    ScanaStudio.gui_add_combo_box("nbits","Bits per word");
    for (i = 2; i < 65; i++)
    {
      if (i == 8)
      {
          ScanaStudio.gui_add_item_to_combo_box(i.toString(10),true);
      }
      else
      {
        ScanaStudio.gui_add_item_to_combo_box(i.toString(10),false);
      }
    }

	ScanaStudio.gui_add_combo_box( "cspol", "Chip Select" );
		ScanaStudio.gui_add_item_to_combo_box( "Active low", true );
		ScanaStudio.gui_add_item_to_combo_box( "Active high" );
	ScanaStudio.gui_add_combo_box( "opt", "MOSI/MISO options" );
		ScanaStudio.gui_add_item_to_combo_box( "None", true );
		ScanaStudio.gui_add_item_to_combo_box( "Ignore MOSI line" );
		ScanaStudio.gui_add_item_to_combo_box( "Ignore MISO line" );
  ScanaStudio.gui_end_tab();
}


//Global variables
var sampling_rate;
var state_machine
var trs_cs,trs_mosi,trs_miso,trs_clk;
var cs_start_sample,cs_end_sample;
var data_mosi,data_miso; //decoded data word
var miso_bit,mosi_bit; //bit value
var clk_active_edge;
var word_start_sample,word_end_sample;
var bit_counter;
// Gui variables
var ch_mosi,ch_miso,ch_clk,ch_cs,bit_order;
var format_hex,format_ascii,format_dec,format_bin;
var cpol,cpha,nbits,cspol,opt;
var configuraiton_valid;

function on_decode_signals(resume)
{
  if (!resume) //If resume == false, it's the first call to this function.
  {
      //initialization code
      configuraiton_valid = true;
      state_machine = 0;
      cs_start_sample = 0;
      sampling_rate = ScanaStudio.get_capture_sample_rate();
      // read GUI values using
      ch_mosi = ScanaStudio.gui_get_value("ch_mosi");
      ch_miso = ScanaStudio.gui_get_value("ch_miso");
      ch_clk = ScanaStudio.gui_get_value("ch_clk");
      ch_cs = ScanaStudio.gui_get_value("ch_cs");
      bit_order = ScanaStudio.gui_get_value("bit_order");
      format_hex = ScanaStudio.gui_get_value("format_hex");
      format_ascii =ScanaStudio.gui_get_value("format_ascii");
      format_dec =ScanaStudio.gui_get_value("format_dec");
      format_bin =ScanaStudio.gui_get_value("format_bin");
      cpol = ScanaStudio.gui_get_value("cpol");
      cpha = ScanaStudio.gui_get_value("cpha");
      nbits = ScanaStudio.gui_get_value("nbits")+2;
      cspol = ScanaStudio.gui_get_value("cspol");
      opt = ScanaStudio.gui_get_value("opt");

      //Do some sanity checks
      if (ch_clk == ch_cs)
      {
        ScanaStudio.console_error_msg( "Error in SPI decoder configuration,"
                                      +"CS and CLK lines must be different");
        configuraiton_valid = false;
      }
      if (ch_mosi == ch_miso)
      {
        ScanaStudio.console_error_msg( "Error in SPI decoder configuration,"
                                      +"MOSI and MISO lines must be different");
        configuraiton_valid = false;
      }

      if (!configuraiton_valid)
      {
        return;
      }

      //set clock active edge
    	if ((cpol == 0) && (cpha == 0)) clk_active_edge = 1;
    	if ((cpol == 0) && (cpha == 1)) clk_active_edge = 0;
    	if ((cpol == 1) && (cpha == 0)) clk_active_edge = 0;
    	if ((cpol == 1) && (cpha == 1)) clk_active_edge = 1;

      //Reset transition iterators
      ScanaStudio.trs_reset(ch_cs);
      ScanaStudio.trs_reset(ch_mosi);
      ScanaStudio.trs_reset(ch_miso);
      ScanaStudio.trs_reset(ch_clk);

  }

  while (ScanaStudio.abort_is_requested() == false)
  {
    //Ensure there are still transitions to be fetched
    if (!ScanaStudio.trs_is_not_last(ch_cs)) break;
    /*if (opt != 1)
    {
        if (!ScanaStudio.trs_is_not_last(ch_miso)) break;
    }
    if (opt != 2)
    {
        if (!ScanaStudio.trs_is_not_last(ch_mosi)) break;
    }*/
    if (!ScanaStudio.trs_is_not_last(ch_clk)) break;


    switch (state_machine)
    {
      case 0: //search for CS leading edge
        trs_cs = ScanaStudio.trs_get_next(ch_cs);
        if (trs_cs.value == cspol) //leading edge found!
        {
          cs_start_sample = trs_cs.sample_index;
          //goto next state
          state_machine++;
        }
        break;
      case 1: //wait for end of CS transition
        trs_cs = ScanaStudio.trs_get_next(ch_cs);
        if (trs_cs.value != cspol) //Lagging edge found!
        {
          cs_end_sample = trs_cs.sample_index;
           // ScanaStudio.console_info_msg("cs_start_sample=" + cs_start_sample);
           // ScanaStudio.console_info_msg("cs_end_sample=" + cs_end_sample);
          if (cs_start_sample == 0)
          {
            //ScanaStudio.console_info_msg("CS warning");
            ScanaStudio.dec_item_new(ch_cs,cs_start_sample,cs_end_sample);
            ScanaStudio.dec_item_emphasize_warning(); //Display this item as a warning
            ScanaStudio.dec_item_add_content("Warning: CS leading edge is missing!");
  					ScanaStudio.dec_item_add_content("Warning: CS!");
  					ScanaStudio.dec_item_add_content("!CS!");
  					ScanaStudio.dec_item_add_content("!");
          }

          //Advance mosi, miso and clk iterators
          if (opt != 1)
          {
            trs_mosi = ScanaStudio.trs_get_before(ch_mosi,cs_start_sample)
            mosi_bit = trs_mosi.value;
          }
          if (opt != 2)
          {
            trs_miso = ScanaStudio.trs_get_before(ch_miso,cs_start_sample);
            miso_bit = trs_miso.value;
          }
          trs_clk = ScanaStudio.trs_get_before(ch_clk,cs_start_sample);

          //Reset mosi/miso data
          data_miso = data_mosi = 0;
          bit_counter = 0;
          //goto next state
          state_machine++;
        }
      case 2: //wait for clk active edge

        trs_clk = ScanaStudio.trs_get_next(ch_clk);
        //ScanaStudio.console_info_msg("Trs_clk=" + trs_clk.sample_index/sampling_rate + "/" + trs_clk.value);
        if (trs_clk.sample_index < cs_start_sample)
        {
          break;
        }
        if (trs_clk.value == clk_active_edge)
        {
          state_machine++;
        }
        if (trs_clk.sample_index > cs_end_sample)
        {
          //ScanaStudio.console_info_msg("trs_clk.sample_index > cs_end_sample");
          state_machine = 0;
        }
        break;
      case 3: //update mosi_bit value
        //ScanaStudio.console_info_msg("state=" + state_machine);
        if (opt == 1) //Ignore MOSI ?
        {
          state_machine++;
          break;
        }

        //ScanaStudio.console_info_msg("trs_mosi.sample_index=" + trs_mosi.sample_index + "/" + trs_clk.sample_index);

        //Ensure mosi_bit represent the right value at active clock edge
        if (trs_mosi.sample_index <= trs_clk.sample_index) //If needed, advance MOSI transition iterator
        {
          //ScanaStudio.console_info_msg("mosi_bit="+trs_mosi.value);
          mosi_bit = trs_mosi.value;
          trs_mosi = ScanaStudio.trs_get_next(ch_mosi);
        }
        else {
          state_machine++;
        }
        break;
      case 4: //update miso_bit value
        //ScanaStudio.console_info_msg("state=" + state_machine);
        if (opt == 2) //Ignore MISO ?
        {
          state_machine++;
          break;
        }

        //Ensure miso_bit represent the right value at active clock edge
        //ScanaStudio.console_info_msg("trs_miso.sample_index=" + trs_miso.sample_index + "/" + trs_clk.sample_index);

        if (trs_miso.sample_index <= trs_clk.sample_index)
        {
          //ScanaStudio.console_info_msg("miso_bit="+trs_miso.value);
          miso_bit = trs_miso.value;
          trs_miso = ScanaStudio.trs_get_next(ch_miso);
        }
        else {
          state_machine++;
        }
        break;
      case 5: //build mosi & miso data
        //ScanaStudio.console_info_msg("state=" + state_machine);
        //ScanaStudio.console_info_msg("bit_counter="+bit_counter+" mosi=" + mosi_bit + " miso=" + miso_bit);
        if (bit_order == 0)
        {
          data_mosi = (data_mosi*2) + mosi_bit;
          data_miso = (data_miso*2) + miso_bit;
        }
        else
        {
          data_mosi += Math.pow(2, bit_counter) * mosi_bit;
          data_miso += Math.pow(2, bit_counter) * miso_bit;
        }

        if (bit_counter == 0)
        {
          word_start_sample = trs_clk.sample_index;
        }

        if (++bit_counter >= nbits)
        {
          word_end_sample = trs_clk.sample_index;
          //ScanaStudio.console_info_msg("Build word DONE, word_start_sample="+word_start_sample+", word_end_sample="+word_end_sample);
          //add decoder item
          if (opt != 1)
          {
              //ScanaStudio.console_info_msg("data_mosi="+data_mosi);
              ScanaStudio.dec_item_new(ch_mosi,word_start_sample,word_end_sample);
              add_spi_content_to_dec_item(data_mosi);
          }

          if (opt != 2)
          {
              //ScanaStudio.console_info_msg("data_miso="+data_miso + "ch_miso=" + ch_miso);
              ScanaStudio.dec_item_new(ch_miso,word_start_sample,word_end_sample);
              add_spi_content_to_dec_item(data_miso);
          }

          bit_counter = 0;
          data_miso = data_mosi = 0;
        }
        state_machine = 2;

        break;
      default:
        state_machine = 0;
    }
  }
}

function add_spi_content_to_dec_item(value)
{
  var content,b;
  var prev_content = "";
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
      content += " " + to_binary_str(value,nbits);
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
      content += pad(value.toString(2),nbits);
    }
    ScanaStudio.dec_item_add_content(content);
    //Add sample points
    // for (b = 0; b < nbits; b++) //Start at 1 to skip start bit
    // {
    //   //TODO
    // }
  }

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

/*  A helper function to convert a number to binary string
    formated in groups of 4 bits (nibles).
*/
function to_binary_str(value, size)
{
  var i;
  var str = "";
  for (i = 0; i < Math.ceil(size/4); i++)
  {
      if (str != "")
      {
        str += " "
      }
      else
      {
        str += "0b"
      }
      str += pad(((value >> (i*4)) & 0xF).toString(2),4);
  }
  return str;
}

//Function called to generate demo siganls (when no physical device is attached)
function on_build_demo_signals()
{
  //Use the function below to get the number of samples to be built
  var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
  var spi_builder = ScanaStudio.BuilderObject;
  var ch_clk = ScanaStudio.gui_get_value("ch_clk");
  var nbits = ScanaStudio.gui_get_value("nbits");
  spi_builder.config(
    ScanaStudio.gui_get_value("ch_mosi"),
    ScanaStudio.gui_get_value("ch_miso"),
    ScanaStudio.gui_get_value("ch_clk"),
    ScanaStudio.gui_get_value("ch_cs"),
    ScanaStudio.gui_get_value("bit_order"),
    ScanaStudio.gui_get_value("cpol"),
    ScanaStudio.gui_get_value("cpha"),
    ScanaStudio.gui_get_value("nbits"),
    ScanaStudio.gui_get_value("cspol"),
    ScanaStudio.builder_get_sample_rate(),
    ScanaStudio.builder_get_sample_rate()/100  //clock frequency
  );

  var random_mosi, random_miso, random_size, w;
  spi_builder.put_silence(10e-6);
  while (ScanaStudio.builder_get_samples_acc(ch_clk) < samples_to_build)
  {
    random_size = Math.floor(Math.random()*10) + 1;
    spi_builder.put_start();
    spi_builder.put_silence(1e-6); //1 ms
    for (w = 0; w < random_size; w++)
    {
      random_mosi = Math.floor(Math.random()*(Math.pow(2,nbits)));
      random_miso = Math.floor(Math.random()*(Math.pow(2,nbits)));
      spi_builder.put_word(random_mosi,random_miso);
      spi_builder.put_silence(1e-6); //1 ms
    }

    spi_builder.put_stop();
    spi_builder.put_silence(1e-3); //1 ms

    if (ScanaStudio.abort_is_requested())
    {
      break;
    }
  }
  spi_builder.put_silence(10e-6);
  spi_builder.put_start();
  spi_builder.put_silence(1e-6); //1 ms
  spi_builder.put_word(0xAA,0x55);
  spi_builder.put_word(0xAA,0x55);
  spi_builder.put_silence(1e-6); //1 ms
  spi_builder.put_stop();
  spi_builder.put_silence(1e-3); //1 ms
  spi_builder.put_start();
  spi_builder.put_silence(1e-6); //1 ms
  spi_builder.put_word(0xAA,0x55);
  spi_builder.put_word(0xAA,0x55);
  spi_builder.put_silence(1e-6); //1 ms
  spi_builder.put_stop();
  spi_builder.put_silence(1e-3); //1 ms
  spi_builder.put_start();
  spi_builder.put_silence(1e-6); //1 ms
  spi_builder.put_word(0xAA,0x55);
  spi_builder.put_word(0xAA,0x55);
  spi_builder.put_silence(1e-6); //1 ms
  spi_builder.put_stop();
  spi_builder.put_silence(1e-3); //1 ms
  //spi_builder.put_word(0xAA);
}

//Builder object that can be shared to other scripts
ScanaStudio.BuilderObject = {
  //to be configured by the user of this object using the setter functions below
  sampling_rate: 1e6,
	put_start : function(parameter)
  {
    this.last_cs = this.cspol;
  },
  put_stop : function(parameter)
  {
    this.last_cs = (~this.cspol & 0x1);
  },
  put_silence : function (duration_s)
  {
    var samples_count = duration_s*this.sample_rate;
    //ScanaStudio.console_info_msg("this.last_cs=" + this.last_cs);
    //ScanaStudio.console_info_msg("samples_count=" + samples_count);
    ScanaStudio.builder_add_samples(this.ch_miso,this.last_miso,samples_count);
    ScanaStudio.builder_add_samples(this.ch_mosi,this.last_mosi,samples_count);
    ScanaStudio.builder_add_samples(this.ch_clk,this.last_clk,samples_count);
    ScanaStudio.builder_add_samples(this.ch_cs,this.last_cs,samples_count);
  },
  put_word : function(w_mosi,w_miso)
  {
    var i;
    var b_mosi,b_miso;
    for (i = 0; i < this.nbits; i++)
    {
      if (this.bit_order == 0)
      {
        b_mosi = ((w_mosi >> (this.nbits - i -1)) & 0x1);
        b_miso = ((w_miso >> (this.nbits - i -1)) & 0x1);
      }
      else
      {
        b_mosi = ((w_mosi >> i) & 0x1);
        b_miso = ((w_miso >> i) & 0x1);
      }
      this.put_bit(b_mosi,b_miso);
    }
  },
  put_bit : function(b_mosi,b_miso)
  {
  	if (this.cpha == 0)
  	{
      this.put_half_bit(b_mosi,b_miso,this.cpol & 0x1,this.cspol);
      this.put_half_bit(b_mosi,b_miso,~this.cpol & 0x1,this.cspol);
  	}
  	else
  	{
      this.put_half_bit(b_mosi,b_miso,~this.cpol & 0x1,this.cspol);
      this.put_half_bit(b_mosi,b_miso,this.cpol & 0x1,this.cspol);
  	}
    this.last_clk = this.cpol;  //reset clock idle state
  },
  put_half_bit : function(b_mosi,b_miso,clk,cs)
  {
    ScanaStudio.builder_add_samples(this.ch_mosi, b_mosi, this.samples_per_half_clock);
    ScanaStudio.builder_add_samples(this.ch_miso, b_miso, this.samples_per_half_clock);
    ScanaStudio.builder_add_samples(this.ch_clk, clk, this.samples_per_half_clock);
    ScanaStudio.builder_add_samples(this.ch_cs, cs, this.samples_per_half_clock);
    this.last_cs = cs;
    this.last_clk = clk;
    this.last_mosi = b_mosi;
    this.last_miso = b_miso;
  },
  config : function(ch_mosi,ch_miso,ch_clk,ch_cs,bit_order,cpol,cpha,nbits,cspol,sample_rate,clk_frequency)
  {
    this.ch_mosi = ch_mosi;
    this.ch_miso = ch_miso;
    this.ch_clk = ch_clk;
    this.ch_cs = ch_cs;
    this.bit_order = bit_order;
    this.cpol = cpol;
    this.cpha = cpha;
    this.nbits = nbits+2;
    this.cspol = cspol;
    this.sample_rate = sample_rate;
    this.samples_per_half_clock = (sample_rate / clk_frequency);
    // ScanaStudio.console_info_msg("cspol=" + cspol);
    // ScanaStudio.console_info_msg("this.cspol=" + this.cspol);

    // //set clock active edge
  	// if ((cpol == 0) && (cpha == 0)) this.clk_active_edge = 1;
  	// if ((cpol == 0) && (cpha == 1)) this.clk_active_edge = 0;
  	// if ((cpol == 1) && (cpha == 0)) this.clk_active_edge = 0;
  	// if ((cpol == 1) && (cpha == 1)) this.clk_active_edge = 1;

    //Set idle states
    this.last_mosi = 0;
    this.last_miso = 0;
    this.last_clk = (cpol & 0x1);
    this.last_cs = (~this.cspol & 0x1);
    //ScanaStudio.console_info_msg("this.last_cs=" + this.last_cs);
  }
};
