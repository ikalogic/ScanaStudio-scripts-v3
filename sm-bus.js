/* Protocol meta info:
<NAME> SMBus </NAME>
<DESCRIPTION>
System Management Bus (SMBus) protocol analyzer.
</DESCRIPTION>
<VERSION> 0.3 </VERSION>
<AUTHOR_NAME>  Ibrahim KAMAL </AUTHOR_NAME>
<AUTHOR_URL> i.kamal@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright Ibrahim KAMAL </COPYRIGHT>
<LICENSE>  This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.3: Added dec_item_end() for each dec_item_new().
V0.2: Added pre-decoding support
V0.1: Initial release.
</RELEASE_NOTES>
*/

/*
Future releases
~~~~~~~~~~~~~~~~
* Detect SMBus host address (when the slave is alerting the host)
* Add pre-decoding support (done, to be tested)
* Write online documentation
* Add hex view support
* Add packet view support
*/

var SMB =
{
	ADDRESS : 0x01,
	DATA  : 0x04,
};

//Decoder GUI
function on_draw_gui_decoder()
{
  ScanaStudio.gui_add_ch_selector("ch_sda","SMBDAT Channel","SMBDAT");
  ScanaStudio.gui_add_ch_selector("ch_scl","SMBCLK Channel","SMBCLK");

  ScanaStudio.gui_add_new_tab("Advanced options",false);
    ScanaStudio.gui_add_check_box("pec_enable","Analyze last byte as PEC",false);
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
var sampling_rate;
var state_machine;

function on_decode_signals(resume)
{
  if (!resume) //If resume == false, it's the first call to this function.
  {
      //initialization code goes here, ex:
      state_machine = 0;
      sampling_rate = ScanaStudio.get_capture_sample_rate(); //TODO remove this, unused
      pec_enable = ScanaStudio.gui_get_value("pec_enable");
      address_opt = ScanaStudio.gui_get_value("address_opt");
      address_format = ScanaStudio.gui_get_value("address_format");
      data_format = ScanaStudio.gui_get_value("data_format");
      frame_state = SMB.ADDRESS;
      sm_data_bytes = [];
  }

  var i2c_items = ScanaStudio.pre_decode("i2c.js",resume);

  var i = 0;
  //ScanaStudio.console_info_msg("I2C items="+i2c_items.length);
  for (i = 0; i < i2c_items.length; i++)
  {
    i2c_items[i].pec = false; //Assume this is not the PEC byte
    sm_data_bytes.push(i2c_items[i]);
    //If SM packet is finished, process it
    if (i2c_items[i].content.indexOf("STOP") >= 0)
    {
      //[S][Addr][ACK][D][ACK][PEC][ACK][P]
      if ((pec_enable == true) && (sm_data_bytes.length > 7))
      {
        //ScanaStudio.console_info_msg("PEC is active");
        //Go back to the last data byte and set it as PEC
        sm_data_bytes[sm_data_bytes.length -3].pec = true;
      }
      var n;
      //ScanaStudio.console_info_msg("SM items="+sm_data_bytes.length);
      for (n = 0; n < sm_data_bytes.length; n++)
      {
        process_sm_item(sm_data_bytes[n]);
      }
      sm_data_bytes = [];
    }
  }
}

function process_sm_item(item)
{
  ScanaStudio.dec_item_new(item.channel_index,item.start_sample_index,item.end_sample_index);

  if (item.content.indexOf("RE-START") >= 0)
  {
    ScanaStudio.dec_item_add_content("RE-START");
    ScanaStudio.dec_item_add_content("RS");
    ScanaStudio.dec_item_add_content("R");
    frame_state = SMB.ADDRESS;
  }
  else if (item.content.indexOf("START") >= 0)
  {
    ScanaStudio.dec_item_add_content("START");
    ScanaStudio.dec_item_add_content("S");
    frame_state = SMB.ADDRESS;
    crc8_reset();
  }
  else if (item.content.indexOf("STOP") >= 0)
  {
    ScanaStudio.dec_item_add_content("STOP");
    ScanaStudio.dec_item_add_content("P");
    frame_state = SMB.ADDRESS;
    //We have a full packet, process it:
  }
  else if (item.content.indexOf("NACK") >= 0)
  {
    ScanaStudio.dec_item_add_content("NACK");
    ScanaStudio.dec_item_add_content("N");
  }
  else if (item.content.indexOf("ACK") >= 0)
  {
    ScanaStudio.dec_item_add_content("ACK");
    ScanaStudio.dec_item_add_content("A");
  }
  else //It's any other address or data byte
  {
    var byte = Number(item.content);
    switch (frame_state) {
      case SMB.ADDRESS:
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
        else if ((byte >> 1) == 0x8)  //SMBus Host
        {
          operation_str = "SMBus host address ";
          operation_str_short = "HOST ";
        }
        else if ((byte >> 1) == 0xC)  //SMBus Alert response
        {
          operation_str = "SMBus Alert response address ";
          operation_str_short = "ALERT ";
        }
        else if ((byte>>3) == 1) //HS-mode master code
        {
          hs_mode = true;
          operation_str = "NOT SUPPORTED: HS-Mode master code ";
          operation_str_short = "! HS ";
          ScanaStudio.dec_item_emphasize_warning();
        }
        else if ((byte >> 3) == 0x1E) //10 bit (extended) address
        {
          add_10b = true;
          ext_add = (byte>>1) & 0x3;
          if (byte & 0x1)
          {
            operation_str = "NOT SUPPORTED: Read from 10 bit address ";
            operation_str_short = "! 10R ";
            ScanaStudio.dec_item_emphasize_warning();
          }
          else
          {
            operation_str = "NOT SUPPORTED: Write to 10 bit address ";
            operation_str_short = "! 10W ";
            ScanaStudio.dec_item_emphasize_warning();
          }
        }
        else if (((byte>>1) == 2) || ((byte>>1) == 3) || ((byte>>3) == 0x1F)) //Reserved
        {
          operation_str = "Reserved address ";
          operation_str_short = "RES ";
          ScanaStudio.dec_item_emphasize_warning();
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

        if (ScanaStudio.is_pre_decoding() == true)
        {
          ScanaStudio.dec_item_add_content(operation_str_short + ":" + format_content(byte >> add_shift,address_format,add_len) + " - R/W = " + (byte & 0x1).toString());
        }
        else
        {
          ScanaStudio.dec_item_add_content(operation_str + format_content(byte >> add_shift,address_format,add_len) + " - R/W = " + (byte & 0x1).toString());
          ScanaStudio.dec_item_add_content(operation_str + format_content(byte >> add_shift,address_format,add_len));
          ScanaStudio.dec_item_add_content(operation_str_short + format_content(byte >> add_shift,address_format,add_len));
          ScanaStudio.dec_item_add_content(format_content(byte >> add_shift,address_format,add_len));
        }

        frame_state = SMB.DATA;

        crc8_calc(byte);
        break;
      case SMB.DATA:
        var title = "DATA = ";
        if (item.pec == true)
        {
          title = "PEC = ";
          if (byte == crc8_get())
          {
            ScanaStudio.dec_item_add_content("PEC = " + format_content(byte,data_format,8) + " OK!");
            ScanaStudio.dec_item_add_content(format_content(byte,data_format,8));
            ScanaStudio.dec_item_emphasize_success();
          }
          else
          {
            ScanaStudio.dec_item_add_content("Wrong PEC = " + format_content(byte,data_format,8) + " Should be = " + format_content(crc8_get(),data_format,8));
            ScanaStudio.dec_item_add_content("Wrong PEC = " + format_content(byte,data_format,8) + " / " + format_content(crc8_get(),data_format,8));
            ScanaStudio.dec_item_add_content("Err !" + format_content(byte,data_format,8));
            ScanaStudio.dec_item_add_content("!" + format_content(byte,data_format,8));
            ScanaStudio.dec_item_add_content(format_content(byte,data_format,8));
            ScanaStudio.dec_item_emphasize_error();
          }
        }
        else
        {
          crc8_calc(byte);
          ScanaStudio.dec_item_add_content("Data = " + format_content(byte,data_format,8));
          ScanaStudio.dec_item_add_content(format_content(byte,data_format,8));
        }
        frame_state = SMB.DATA;
        break;
      default:
    }
  }

  ScanaStudio.dec_item_end();
}

//Function called to generate demo siganls (when no physical device is attached)
function on_build_demo_signals()
{

  //Use the function below to get the number of samples to be built
  var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
  i2c_builder = ScanaStudio.load_builder_object("i2c.js");
  ch_sda = ScanaStudio.gui_get_value("ch_sda");
  ch_scl = ScanaStudio.gui_get_value("ch_scl");
  pec_enable = ScanaStudio.gui_get_value("pec_enable");
  smb_f = ScanaStudio.builder_get_sample_rate()/100;
  var silence_period = (samples_to_build / (125));
  if (smb_f < 1) smb_f = 1;
  if (smb_f > 100e3) smb_f = 100e3;
  i2c_builder.config(ch_scl,ch_sda,smb_f);

  while (ScanaStudio.builder_get_samples_acc(ch_scl) < samples_to_build)
  {
    i2c_builder.put_silence(silence_period);
    i2c_builder.put_start();
    crc8_reset();
    var random_size = Math.floor(Math.random()*10) + 1;
    var w;
    for (w = 0; w < random_size; w++)
    {
      random_data = Math.round(Math.random()*256);
      if (w == random_size-1)
      {
        if (pec_enable && (w > 0))
        {
          random_data = crc8_get();
        }
        ack = 1;
      }
      else
      {
        crc8_calc(random_data);
        ack = 0;
      }
      i2c_builder.put_byte(random_data,ack);
    }
    i2c_builder.put_stop();
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



/*
 SMBus CRC calculation functions
*/
var crc;
var POLYNOMIAL = (0x1070 << 3);
function crc8_reset()
{
  crc = 0;
}

function crc8_get()
{
  return (crc);
}

function crc8_calc(inData )
{
	var i;
  var data;
  data = crc ^ inData;
  data <<= 8;

	for (i = 0; i < 8; i++)
  {
		if (( data & 0x8000 ) != 0 )
    {
        data = data ^ POLYNOMIAL;
    }
		data = data << 1;
	}

	crc = ( data >> 8 ) & 0xFF;
}
