/* Protocol meta info:
<NAME> I2C scanner</NAME>
<DESCRIPTION>
This script is used to help scanning an I2C bus to find all valid adddresses
(addresses for which a device is responding with an acknowledged).
This script is not meant to be a full functionnal I2C analyzer, but rather a simplified
version that focuses on finding devices on a bus.
The signal builder feature can be used to generate a series of I2C address calls
to scan the whole range of possible addresses.
</DESCRIPTION>
<VERSION> 0.4 </VERSION>
<AUTHOR_NAME> Ibrahim KAMAL </AUTHOR_NAME>
<AUTHOR_URL> i.kamal@ikalogic.com, v.canoz@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright Ibrahim KAMAL </COPYRIGHT>
<LICENSE> This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.4:  Bug fixed : No silence periode on the first launch.
V0.3:  Added Signal decoder capability, PacketView and emphasis on valid (ACK) addresses.
V0.2:  Added description.
V0.1:  Initial release.
</RELEASE_NOTES>
*/


//Decoder GUI
function on_draw_gui_decoder()
{
  //Define decoder configuration GUI
  ScanaStudio.gui_import_from_decoder("i2c.js");
}

//Evaluate decoder GUI
function on_eval_gui_decoder()
{
  return ""; //All good.
}

//Global variables
var ch_sda,ch_scl,i2c_freq,skip_addresses,address_format;
var state_machine;
var pkt_start,pkt_address;
function on_decode_signals(resume)
{
  if (!resume) //If resume == false, it's the first call to this function.
  {
      //initialization code goes here, ex:
      state_machine = 0;
      address_format = ScanaStudio.gui_get_value("address_format");
      address_opt = ScanaStudio.gui_get_value("address_opt");
      if (address_opt == 0)
      {
        add_len = 7;
        add_shift = 1;
      }
      else
      {
        add_len = 8;
        add_shift = 0;
      }
  }


  var i2c_items = ScanaStudio.pre_decode("i2c.js",resume);

  var i = 0;
  for (i = 0; i < i2c_items.length; i++)
  {
    // ScanaStudio.dec_item_new(i2c_items[i].channel_index,i2c_items[i].start_sample_index,i2c_items[i].end_sample_index);
    // ScanaStudio.dec_item_add_content(i2c_items[i].content);
    // ScanaStudio.dec_item_end();

    switch (state_machine)
    {
      case 0: //wait for start
        if (i2c_items[i].content.indexOf("START") >= 0)
        {
          pkt_start = i2c_items[i].start_sample_index;
          state_machine++;
        }
        break;
      case 1:
        pkt_address = Number(i2c_items[i].content) >> add_shift;
        state_machine++;
        break;
      case 2: //wait for ACK or NACK
        if (i2c_items[i].content.indexOf("NACK") >= 0)
        {
          ScanaStudio.dec_item_new(i2c_items[i].channel_index,pkt_start,i2c_items[i].end_sample_index);
          ScanaStudio.dec_item_add_content("No response from address: " + format_content(pkt_address,address_format,add_len));
          ScanaStudio.dec_item_add_content("No response from: " + format_content(pkt_address,address_format,add_len));
          ScanaStudio.dec_item_add_content("Nack: " + format_content(pkt_address,address_format,add_len));
          ScanaStudio.dec_item_add_content(format_content(pkt_address,address_format,add_len)+"!");
          ScanaStudio.dec_item_end();
          state_machine = 0;
        }
        else if (i2c_items[i].content.indexOf("ACK") >= 0)
        {
          ScanaStudio.dec_item_new(i2c_items[i].channel_index,pkt_start,i2c_items[i].end_sample_index);
          ScanaStudio.dec_item_add_content("Acknowledged from address: " + format_content(pkt_address,address_format,add_len));
          ScanaStudio.dec_item_add_content("Acknowledged from: " + format_content(pkt_address,address_format,add_len));
          ScanaStudio.dec_item_add_content("Ack: " + format_content(pkt_address,address_format,add_len));
          ScanaStudio.dec_item_add_content(format_content(pkt_address,address_format,add_len));
          ScanaStudio.dec_item_emphasize_success();
          ScanaStudio.dec_item_end();

          ScanaStudio.packet_view_add_packet(true,i2c_items[i].channel_index,pkt_start,i2c_items[i].end_sample_index,
            "I2C","Acknowledged from: "+format_content(pkt_address,address_format,add_len),
            ScanaStudio.PacketColors.Wrap.Title,ScanaStudio.PacketColors.Wrap.Content);
          state_machine = 0;
        }

        break;
      default:
    }
  }
}

//Signal builder GUI
function on_draw_gui_signal_builder()
{
  ScanaStudio.gui_add_ch_selector("ch_sda","SDA Channel","SDA");
  ScanaStudio.gui_add_ch_selector("ch_scl","SCL Channel","SCL");
  ScanaStudio.gui_add_engineering_form_input_box("i2c_freq","I2C clock frequency",10,3.4e6,100e3,"Hz");
  ScanaStudio.gui_add_check_box("skip_addresses","Skip reserved I2C adddresses",true);
}

//Evaluate signal builder GUI (optionnal)
function on_eval_gui_signal_builder()
{
  i2c_freq = ScanaStudio.gui_get_value("i2c_freq");
  if (i2c_freq >= ScanaStudio.builder_get_sample_rate()/10)
  {
    return "I2C frequency is too high. The maximum value for the current sampling rate is: "
    + ScanaStudio.engineering_notation(ScanaStudio.builder_get_sample_rate()/10,3) + "Hz";
  }
  return ""; //All good.
}


//Function called to build siganls (to be generate by capable device)
function on_build_signals()
{
  //Use the function below to get the number of samples to be built
  var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
  var builder = ScanaStudio.load_builder_object("i2c.js");
  i2c_freq = ScanaStudio.gui_get_value("i2c_freq");
  ch_sda = ScanaStudio.gui_get_value("ch_sda");
  ch_scl = ScanaStudio.gui_get_value("ch_scl");
  skip_addresses = ScanaStudio.gui_get_value("skip_addresses");
  var silence_period = 10*ScanaStudio.builder_get_sample_rate()/i2c_freq; //10 clock silence period
  builder.config(ch_scl,ch_sda,i2c_freq);

  for (var i = 0; i < 127; i++)
  {
    var address = (i<<1)&0xFF;
    if (skip_addresses)
    {
      if ((i == 0)
      || (i == 1)
      || (i == 2)
      || (i == 3)
      || ((i & 0x7C )==4)
      || ((i & 0x7C )==0x7C)
      || ((i & 0x7C )==0x78) )
      {
        continue; //Skip those addresses.
      }
    }

    builder.put_silence(silence_period);
    builder.put_start();
    builder.put_byte(address,1);
    builder.put_stop();
    builder.put_silence(silence_period);
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
