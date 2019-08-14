/* Protocol meta info:
<NAME> I2C </NAME>
<DESCRIPTION>
I2C support for ScanaStudio.
</DESCRIPTION>
<VERSION> 0.5 </VERSION>
<AUTHOR_NAME>  Ibrahim KAMAL </AUTHOR_NAME>
<AUTHOR_URL> i.kamal@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright Ibrahim KAMAL </COPYRIGHT>
<LICENSE>  This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.5: Added dec_item_end() for each dec_item_new().
V0.4: Fixed warnings in script log when decoding random non-I2C signals
V0.3: Better demo mode generator
V0.2: Added support for 10b addresses, added support for pre-decoding.
V0.1: Initial release.
</RELEASE_NOTES>
*/

/*
Future releases
~~~~~~~~~~~~~~~~
* Documentation
* Add hex view support
* Add packet view support
*/

//Decoder GUI
function on_draw_gui_decoder()
{
  //Define decoder configuration GUI
  ScanaStudio.gui_add_ch_selector("ch_sda","SDA Channel","SDA");
  ScanaStudio.gui_add_ch_selector("ch_scl","SCL Channel","SCL");
  ScanaStudio.gui_add_new_tab("Advanced options",false);
    ScanaStudio.gui_add_combo_box("address_opt","Address convention");
      ScanaStudio.gui_add_item_to_combo_box("7 bit address",true);
      ScanaStudio.gui_add_item_to_combo_box("8 bit address (inlcuding R/W flag)",false);
    ScanaStudio.gui_add_combo_box("address_format","Address display format");
      ScanaStudio.gui_add_item_to_combo_box("HEX",true);
      ScanaStudio.gui_add_item_to_combo_box("Binary",false);
      ScanaStudio.gui_add_item_to_combo_box("Decimal",false);
    ScanaStudio.gui_add_combo_box("data_format","Data display format");
      ScanaStudio.gui_add_item_to_combo_box("HEX",true);
      ScanaStudio.gui_add_item_to_combo_box("Binary",false);
      ScanaStudio.gui_add_item_to_combo_box("Decimal",false);
      ScanaStudio.gui_add_item_to_combo_box("ASCII",false);
  ScanaStudio.gui_end_tab();
}

//Global variables
var I2C =
{
	ADDRESS : 0x01,
	ACK  : 0x02,
	DATA  : 0x04,
  ADDRESS_EXT : 0x08,
};
var sampling_rate;
var state_machine;
var i2c_sample_points = [];

function on_decode_signals(resume)
{
  var i2c_condition_width;
  if (!resume) //If resume == false, it's the first call to this function.
  {
      sampling_rate = ScanaStudio.get_capture_sample_rate();
      //get GUI values
      ch_sda = ScanaStudio.gui_get_value("ch_sda");
      ch_scl = ScanaStudio.gui_get_value("ch_scl");
      address_opt = ScanaStudio.gui_get_value("address_opt");
      address_format = ScanaStudio.gui_get_value("address_format");
      data_format = ScanaStudio.gui_get_value("data_format");

      //Reset iterator
      ScanaStudio.trs_reset(ch_sda);
      ScanaStudio.trs_reset(ch_scl);
      trs_scl = ScanaStudio.trs_get_next(ch_scl);
      trs_sda = ScanaStudio.trs_get_next(ch_sda);

      //init global variables
      state_machine = 0;
      last_dec_item_end_sample = 0;
      add_10b = false;
      ext_add = 0;
      hs_mode = false;
      frame_state = I2C.ADDRESS;
      packet_started = false;
      byte_counter = 0;
      bit_counter = 0;
      byte = 0;
      //ScanaStudio.console_info_msg("Decoding started");
  }
  else {
    //ScanaStudio.console_info_msg("Decoding resumed");
  }

  while (ScanaStudio.abort_is_requested() == false)
  {
    if ((!ScanaStudio.trs_is_not_last(ch_sda)) && (!ScanaStudio.trs_is_not_last(ch_scl)))
    {
      break;
    }

    switch (state_machine)
    {
      case 0: //advance SCL
        last_trs_scl = trs_scl;
        trs_scl = ScanaStudio.trs_get_next(ch_scl);
        //ScanaStudio.console_info_msg("SCL " + trs_scl.sample_index, trs_scl.sample_index);
        state_machine++;
        break;
      case 1: //Advance SDA iterator and detect bits or conditions
        if (trs_sda.sample_index <= trs_scl.sample_index)
        {
          last_trs_sda = trs_sda;
          trs_sda = ScanaStudio.trs_get_next(ch_sda);
          //ScanaStudio.console_info_msg("SDA " + trs_sda.sample_index, trs_sda.sample_index);
          if ((last_trs_sda.sample_index > last_trs_scl.sample_index)
              && (last_trs_sda.sample_index < trs_scl.sample_index)
              && (last_trs_scl.value == 1)) //Check S/P condition
          {
            if ((last_trs_sda.value == 0))
            {
              i2c_condition_width = (trs_scl.sample_index - last_trs_sda.sample_index)*0.75;
              if (last_trs_sda.sample_index - i2c_condition_width <= last_dec_item_end_sample)
              {
                  i2c_condition_width = 2;
                  ScanaStudio.dec_item_new(ch_sda,last_dec_item_end_sample+1,last_dec_item_end_sample + i2c_condition_width);
                  last_dec_item_end_sample += i2c_condition_width;
              }
              else
              {
                ScanaStudio.dec_item_new(ch_sda,last_trs_sda.sample_index - i2c_condition_width,last_trs_sda.sample_index + i2c_condition_width);
                last_dec_item_end_sample = last_trs_sda.sample_index + i2c_condition_width;
              }

              if (packet_started)
              {
                ScanaStudio.dec_item_add_content("RE-START");
                ScanaStudio.dec_item_add_content("RS");
                ScanaStudio.dec_item_add_content("R");
              }
              else
              {
                ScanaStudio.dec_item_add_content("START");
                ScanaStudio.dec_item_add_content("S");
              }

              ScanaStudio.dec_item_end();
              //ScanaStudio.console_error_msg("Start found!",last_trs_sda.sample_index);
              add_10b = false;
              packet_started = true;
              byte_counter = 0;
              bit_counter = 0;
              i2c_sample_points = []; //clear
              frame_state = I2C.ADDRESS;
            }
            else
            {
              i2c_condition_width = (last_trs_sda.sample_index-last_trs_scl.sample_index)*0.75;

              if (last_trs_sda.sample_index - i2c_condition_width <= last_dec_item_end_sample)
              {
                  i2c_condition_width = 2;
                  ScanaStudio.dec_item_new(ch_sda,last_dec_item_end_sample+1,last_dec_item_end_sample + i2c_condition_width);
                  last_dec_item_end_sample += i2c_condition_width;
              }
              else
              {
                ScanaStudio.dec_item_new(ch_sda,last_trs_sda.sample_index - i2c_condition_width,last_trs_sda.sample_index + i2c_condition_width);
                last_dec_item_end_sample = last_trs_sda.sample_index + i2c_condition_width;
              }

              ScanaStudio.dec_item_add_content("STOP");
              ScanaStudio.dec_item_add_content("P");
              ScanaStudio.dec_item_end();

              //ScanaStudio.console_error_msg("STOP found!",last_trs_sda.sample_index);
              hs_mode = false;
              packet_started = false;
            }
          }
        }
        else {

          if (trs_scl.value == 1)
          {
            //ScanaStudio.console_info_msg("SDA bit value=" + last_trs_sda.value,trs_scl.sample_index);
            if (packet_started == true)
            {
              process_i2c_bit(last_trs_sda.value,trs_scl.sample_index);
            }
          }
          state_machine = 0;
        }
        break;
    }
  }
}

function process_i2c_bit(value,sample_index)
{
  if (bit_counter == 0)
  {
    byte = 0;
    i2c_sample_points = []; //clear
  }
  byte = (byte * 2) | value;
  i2c_sample_points.push(sample_index);
  //ScanaStudio.console_info_msg("byte = 0x"+byte.toString(16));
  bit_counter++;
  if (bit_counter == 1) start_sample = sample_index;

  switch (frame_state) {
    case I2C.ACK:
      //ScanaStudio.console_info_msg("ACK sample = " + start_sample);

      if (start_sample-i2c_byte_margin*0.5 <= last_dec_item_end_sample)
      {
        ScanaStudio.dec_item_new(ch_sda,last_dec_item_end_sample+1,last_dec_item_end_sample + i2c_byte_margin*0.5);
        last_dec_item_end_sample += i2c_byte_margin*0.5;
      }
      else
      {
        ScanaStudio.dec_item_new(ch_sda,start_sample-i2c_byte_margin*0.5,start_sample+i2c_byte_margin*0.5);
        last_dec_item_end_sample = start_sample+i2c_byte_margin*0.5;
      }

      if (value == 1)
      {
        ScanaStudio.dec_item_add_content("NACK");
        ScanaStudio.dec_item_add_content("N");
      }
      else {
        ScanaStudio.dec_item_add_content("ACK");
        ScanaStudio.dec_item_add_content("A");
      }
      add_sample_points();
      ScanaStudio.dec_item_end();

      if (hs_mode)
      {
        frame_state = I2C.ADDRESS;
        hs_mode = false;
      }
      else if (add_10b == true)
      {
        add_10b = false;
        frame_state = I2C.ADDRESS_EXT;
      }
      else {
        frame_state = I2C.DATA;
      }
      bit_counter = 0;
      break;
    case I2C.ADDRESS:
      if (bit_counter >= 8)
      {
        i2c_byte_margin = (sample_index - start_sample)/16;
        if ((start_sample-i2c_byte_margin) <= last_dec_item_end_sample)
        {
          ScanaStudio.dec_item_new(ch_sda,last_dec_item_end_sample+1,last_dec_item_end_sample + i2c_byte_margin);
          last_dec_item_end_sample += i2c_byte_margin;
        }
        else
        {
          ScanaStudio.dec_item_new(ch_sda,start_sample-i2c_byte_margin,sample_index+i2c_byte_margin);
          last_dec_item_end_sample = sample_index+i2c_byte_margin;
        }

        if (ScanaStudio.is_pre_decoding() == true)
        {
          ScanaStudio.dec_item_add_content("0x" + byte.toString(16));
          bit_counter = 0;
          frame_state = I2C.ACK;
          break;
        }
        if (byte == 0) //General call
        {
          operation_str = "General call address ";
          operation_str_short = "G ";
        }
        else if (byte == 1) //General call
        {
          operation_str = "Start byte ";
          operation_str_short = "SB ";
        }
        else if ((byte>>1) == 1) //CBUS
        {
          operation_str = "CBUS address ";
          operation_str_short = "CBUS ";
        }
        else if (((byte>>1) == 2) || ((byte>>1) == 3) || ((byte>>3) == 0x1F)) //Reserved
        {
          operation_str = "Reserved address ";
          operation_str_short = "RES ";
          ScanaStudio.dec_item_emphasize_warning();
        }
        else if ((byte>>3) == 1) //HS-mode master code
        {
          hs_mode = true;
          operation_str = "HS-Mode master code ";
          operation_str_short = "HS ";
        }
        else if ((byte >> 3) == 0x1E) //10 bit (extended) address
        {
          add_10b = true;
          ext_add = (byte>>1) & 0x3;
          if (byte & 0x1)
          {
            operation_str = "Read from 10 bit address ";
            operation_str_short = "10R ";
          }
          else
          {
            operation_str = "Write to 10 bit address ";
            operation_str_short = "10W ";
          }
        }
        else if (byte & 0x1)
        {
          operation_str = "Read from address ";
          operation_str_short = "RD ";
        }
        else
        {
          operation_str = "Write to address ";
          operation_str_short = "WR ";
        }

        if (address_opt == 0) //7 bit standard address convention
        {
          add_len = 7
          add_shift = 1;
        }
        else
        {
          add_len = 8;
          add_shift = 0;
        }

        ScanaStudio.dec_item_add_content(operation_str + format_content(byte >> add_shift,address_format,add_len) + " - R/W = " + (byte & 0x1).toString());
        ScanaStudio.dec_item_add_content(operation_str + format_content(byte >> add_shift,address_format,add_len));
        ScanaStudio.dec_item_add_content(operation_str_short + format_content(byte >> add_shift,address_format,add_len));
        ScanaStudio.dec_item_add_content(format_content(byte >> add_shift,address_format,add_len));
        add_sample_points();
        ScanaStudio.dec_item_end();

        bit_counter = 0;
        frame_state = I2C.ACK;
      }
      break;
    case I2C.ADDRESS_EXT:
      if (bit_counter >= 8)
      {
        ext_add = (ext_add << 8) + byte;
        i2c_byte_margin = (sample_index - start_sample)/16;

        if (start_sample-i2c_byte_margin <= last_dec_item_end_sample)
        {
          ScanaStudio.dec_item_new(ch_sda,last_dec_item_end_sample+1,last_dec_item_end_sample + i2c_byte_margin);
          last_dec_item_end_sample += i2c_byte_margin;
        }
        else
        {
          ScanaStudio.dec_item_new(ch_sda,start_sample-i2c_byte_margin,sample_index+i2c_byte_margin);
          last_dec_item_end_sample = start_sample+i2c_byte_margin;
        }

        ScanaStudio.dec_item_add_content("10 bit address = " + format_content(ext_add,address_format,10));
        ScanaStudio.dec_item_add_content("10b add. = " + format_content(ext_add,address_format,10));
        ScanaStudio.dec_item_add_content(format_content(ext_add,address_format,10));
        add_sample_points();
        ScanaStudio.dec_item_end();

        bit_counter = 0;
        frame_state = I2C.ACK;
      }
      break;
    case I2C.DATA:
      if (bit_counter >= 8)
      {
        i2c_byte_margin = (sample_index - start_sample)/16;

        if (start_sample-i2c_byte_margin <= last_dec_item_end_sample)
        {
          ScanaStudio.dec_item_new(ch_sda,last_dec_item_end_sample+1,last_dec_item_end_sample + i2c_byte_margin);
          last_dec_item_end_sample += i2c_byte_margin;
        }
        else
        {
          ScanaStudio.dec_item_new(ch_sda,start_sample-i2c_byte_margin,sample_index+i2c_byte_margin);
          last_dec_item_end_sample = start_sample+i2c_byte_margin;
        }

        if (ScanaStudio.is_pre_decoding() == true)
        {
          ScanaStudio.dec_item_add_content("0x" + byte.toString(16));
        }
        else
        {
          ScanaStudio.dec_item_add_content("DATA = " + format_content(byte,data_format,8));
          ScanaStudio.dec_item_add_content(format_content(byte,data_format,8));
          add_sample_points();
        }
        ScanaStudio.dec_item_end();

        bit_counter = 0;
        frame_state = I2C.ACK;
      }
      break;
    default:

  }
}

function add_sample_points()
{
  var s;
  for (s = 0; s < i2c_sample_points.length; s++)
  {
    ScanaStudio.dec_item_add_sample_point(i2c_sample_points[s],"P");
  }
}

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

//Function called to generate demo siganls (when no physical device is attached)
function on_build_demo_signals()
{
  //Use the function below to get the number of samples to be built
  var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
  var i2c_builder = ScanaStudio.BuilderObject;
  var sample_rate = ScanaStudio.builder_get_sample_rate();
  ch_sda = ScanaStudio.gui_get_value("ch_sda");
  ch_scl = ScanaStudio.gui_get_value("ch_scl");
  i2c_f = ScanaStudio.builder_get_sample_rate()/100;
  var silence_period = (samples_to_build / (125));
  if (i2c_f < 1) i2c_f = 1;
  if (i2c_f > 100e3) i2c_f = 100e3;

  i2c_builder.config(ch_scl,ch_sda,i2c_f);
  i2c_builder.put_silence(silence_period);

  i2c_builder.put_start();
  i2c_builder.put_byte(0xF7,0); //10b address
  i2c_builder.put_byte(0xFF,0);
  i2c_builder.put_byte(0x55,1);
  i2c_builder.put_stop();
  i2c_builder.put_silence(silence_period);

  i2c_builder.put_start();
  i2c_builder.put_byte(0x00,0); //General call address
  i2c_builder.put_byte(0xA1,0);
  i2c_builder.put_byte(0x55,1);
  i2c_builder.put_stop();
  i2c_builder.put_silence(silence_period);

  i2c_builder.put_start();
  i2c_builder.put_byte(0x01,0); //Star byte call address
  i2c_builder.put_start();
  i2c_builder.put_byte(0xA1,0);
  i2c_builder.put_byte(0x55,1);
  i2c_builder.put_stop();
  i2c_builder.put_silence(silence_period);

  i2c_builder.put_start();
  i2c_builder.put_byte(0x08,0); //HS mode
  i2c_builder.put_start();
  i2c_builder.put_byte(0xA1,0);
  i2c_builder.put_byte(0x55,1);
  i2c_builder.put_stop();
  i2c_builder.put_silence(silence_period);

  i2c_builder.put_start();
  i2c_builder.put_byte(0x07,0); //RFU
  i2c_builder.put_byte(0xA1,0);
  i2c_builder.put_byte(0x55,1);
  i2c_builder.put_stop();
  i2c_builder.put_silence(silence_period);

  while (ScanaStudio.builder_get_samples_acc(ch_scl) < samples_to_build)
  {
    i2c_builder.put_silence(silence_period);
    i2c_builder.put_start();
    var random_size = Math.floor(Math.random()*10) + 1;
    var w;
    for (w = 0; w < random_size; w++)
    {
      random_data = Math.round(Math.random()*256);
      if (w == random_size-1)
      {
        ack = 1;
      }
      else
      {
        ack = 0;
      }
      i2c_builder.put_byte(random_data,ack);
    }
    i2c_builder.put_stop();
  }
}


//Builder object that can be shared to other scripts
ScanaStudio.BuilderObject = {
  put_silence : function(s)
  {
    ScanaStudio.builder_add_samples(this.ch_scl,this.last_scl,s);
    ScanaStudio.builder_add_samples(this.ch_sda,this.last_sda,s);
  },
	put_start : function()
  {
    if (this.last_sda !=1)
    {
      this.last_scl = 0;
      ScanaStudio.builder_add_samples(this.ch_scl,this.last_scl,this.samples_per_quarter_clock);
      ScanaStudio.builder_add_samples(this.ch_sda,this.last_sda,this.samples_per_quarter_clock);
      this.last_sda = 1;
      ScanaStudio.builder_add_samples(this.ch_scl,this.last_scl,this.samples_per_quarter_clock);
      ScanaStudio.builder_add_samples(this.ch_sda,this.last_sda,this.samples_per_quarter_clock);
      this.last_scl = 1;
      this.last_sda = 1;
      ScanaStudio.builder_add_samples(this.ch_scl,this.last_scl,this.samples_per_quarter_clock);
      ScanaStudio.builder_add_samples(this.ch_sda,this.last_sda,this.samples_per_quarter_clock);
    }

    this.last_sda = 0;
    ScanaStudio.builder_add_samples(this.ch_scl,this.last_scl,this.samples_per_quarter_clock);
    ScanaStudio.builder_add_samples(this.ch_sda,this.last_sda,this.samples_per_quarter_clock);
  },
  put_stop : function()
  {
    if (this.last_sda != 0)
    {
      this.last_scl = 0;
      ScanaStudio.builder_add_samples(this.ch_scl,this.last_scl,this.samples_per_quarter_clock);
      ScanaStudio.builder_add_samples(this.ch_sda,this.last_sda,this.samples_per_quarter_clock);
      this.last_sda = 0;
      ScanaStudio.builder_add_samples(this.ch_scl,this.last_scl,this.samples_per_quarter_clock);
      ScanaStudio.builder_add_samples(this.ch_sda,this.last_sda,this.samples_per_quarter_clock);
      this.last_scl = 1;
      this.last_sda = 0;
      ScanaStudio.builder_add_samples(this.ch_scl,this.last_scl,this.samples_per_quarter_clock);
      ScanaStudio.builder_add_samples(this.ch_sda,this.last_sda,this.samples_per_quarter_clock);
    }
    this.last_sda = 1;
    ScanaStudio.builder_add_samples(this.ch_scl,this.last_scl,this.samples_per_quarter_clock);
    ScanaStudio.builder_add_samples(this.ch_sda,this.last_sda,this.samples_per_quarter_clock);
  },
  put_byte : function(byte,ack)
  {
    var b = 0;
    for (b = 7; b >= 0; b--)
    {
      this.put_bit((byte >> b) & 0x1);
    }
    this.put_bit(ack);
  },
  put_bit : function(b)
  {
    ScanaStudio.builder_add_samples(this.ch_scl,0,this.samples_per_quarter_clock);
    ScanaStudio.builder_add_samples(this.ch_sda,this.last_sda,this.samples_per_quarter_clock);

    this.last_sda = b;
    ScanaStudio.builder_add_samples(this.ch_scl,0,this.samples_per_quarter_clock);
    ScanaStudio.builder_add_samples(this.ch_sda,this.last_sda,this.samples_per_quarter_clock);

    ScanaStudio.builder_add_samples(this.ch_scl,1,this.samples_per_quarter_clock);
    ScanaStudio.builder_add_samples(this.ch_sda,this.last_sda,this.samples_per_quarter_clock);

    ScanaStudio.builder_add_samples(this.ch_scl,1,this.samples_per_quarter_clock);
    ScanaStudio.builder_add_samples(this.ch_sda,this.last_sda,this.samples_per_quarter_clock);
  },
  config : function(ch_scl,ch_sda,frequency)
  {
    this.ch_sda = ch_sda;
    this.ch_scl = ch_scl;
    this.last_sda = 1;
    this.last_scl = 1;
    this.samples_per_quarter_clock = ScanaStudio.builder_get_sample_rate() / (frequency*4);
  }
};
