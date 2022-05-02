/* Protocol meta info:
<NAME> I2C Temperature and Humidity sensors </NAME>
<DESCRIPTION>
I2C Temperature Sensors and Humidity Sensors decoder. Supported sensors : SHT20, SHT21, SHT25, STS21, HTU21A, HTU20D, HTU21D, HTU_3800, Si7006_A10, Si7020_A10, Si7021_A10, Si7013_A10
</DESCRIPTION>
<VERSION> 0.3 </VERSION>
<AUTHOR_NAME>  Ibrahim KAMAL </AUTHOR_NAME>
<AUTHOR_URL> i.kamal@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright Ibrahim KAMAL </COPYRIGHT>
<LICENSE>  This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.3: Added option to filter high-frequency noise
V0.2: Fixed bug : CMD not decoded after a Soft Reset
V0.1: Ported from older decoders library (https://github.com/ikalogic/ScanaStudio-Decoders/blob/master/I2C_temp_hum_sens.js)
</RELEASE_NOTES>
*/

var I2C_FRAME =
{
	ADDRESS  : 0x01,
  CMD          : 0x02,
  DATA_MSB     : 0x04,
  DATA_LSB     : 0x05,
  CHKSUM       : 0xFF
};

var DEVICE_TABLE =
[
	{code: 0x40,  grp: 1,  str: "SHT20"},
	{code: 0x40,  grp: 1,  str: "SHT21"},
	{code: 0x40,  grp: 1,  str: "SHT25"},
	{code: 0x4A,  grp: 1,  str: "STS21"},
	{code: 0x40,  grp: 1,  str: "HTU21A"},
	{code: 0x40,  grp: 1,  str: "HTU20D"},
	{code: 0x40,  grp: 1,  str: "HTU21D"},
	{code: 0x40,  grp: 1,  str: "HTU_3800"},
	{code: 0x40,  grp: 1,  str: "Si7006"},
	{code: 0x40,  grp: 1,  str: "Si7020"},
	{code: 0x40,  grp: 1,  str: "Si7021"},
	{code: 0x40,  grp: 2,  str: "Si7013"}
];

function i2c_cmd(name,short_name,code)
{
  this.name = name;
  this.name_short = short_name;
  this.code = code;
}

var i2c_cmd_db;
function update_cmd_database()
{
  i2c_cmd_db = [];
  i2c_cmd_db.push(new i2c_cmd("Temperature Measure Hold Master","T-HM",0xE3));
  i2c_cmd_db.push(new i2c_cmd("RH Measure Hold Master","RH-HM", 0xE5));
  i2c_cmd_db.push(new i2c_cmd("Temperature Measure (no hold Master)","T", 0xF3));
  i2c_cmd_db.push(new i2c_cmd("RH Measure (no hold master)","RH",0xF5));
  i2c_cmd_db.push(new i2c_cmd("WRITE REGISTER","W REG", 0xE6));
  i2c_cmd_db.push(new i2c_cmd("READ REGISTER","R REG", 0XE7));
  i2c_cmd_db.push(new i2c_cmd("SOFT RESET","RST", 0xFE));
  i2c_cmd_db.push(new i2c_cmd("Measure voltage / Thermistor temperature","V/TH", 0xEE));
  i2c_cmd_db.push(new i2c_cmd("Read temperature from previous RS measure","T prev.", 0xE0));
  i2c_cmd_db.push(new i2c_cmd("Write Voltage measurement setup","W UR2", 0x50));
  i2c_cmd_db.push(new i2c_cmd("Read Voltage measurement setup","R UR2", 0x10));
  i2c_cmd_db.push(new i2c_cmd("Write heater setup","WHS", 0x51));
  i2c_cmd_db.push(new i2c_cmd("Read heater setup","RHS", 0x11));
  i2c_cmd_db.push(new i2c_cmd("Write thermistor correction coef.","W Coef.", 0xC5));
  i2c_cmd_db.push(new i2c_cmd("Read thermistor correction coef.","R Coef.", 0x84));
  i2c_cmd_db.push(new i2c_cmd("Read ID 1st byte (MSB)","ID1-MSB", 0xFA));
  i2c_cmd_db.push(new i2c_cmd("Read ID 1st byte (LSB)","ID1-LSB", 0x0F));
  i2c_cmd_db.push(new i2c_cmd("Read ID 2ns byte (MSB)","ID2-MSB", 0xFC));
  i2c_cmd_db.push(new i2c_cmd("Read ID 2nd byte (LSB)","ID2-LSB", 0xC9));
  i2c_cmd_db.push(new i2c_cmd("Read firmware version (MSB)","FW-MSB", 0x84));
  i2c_cmd_db.push(new i2c_cmd("Read firmware version (LSB)","FW-LSB", 0xB8));
}

//Decoder GUI
function on_draw_gui_decoder()
{
  //Define decoder configuration GUI
  ScanaStudio.gui_add_ch_selector("ch_sda","SDA Channel","SDA");
  ScanaStudio.gui_add_ch_selector("ch_scl","SCL Channel","SCL");
  ScanaStudio.gui_add_combo_box("uiDevice","Device");
  var first_item = true;
  var i;
  for (i = 0; i < DEVICE_TABLE.length; i++)
  {
    ScanaStudio.gui_add_item_to_combo_box(DEVICE_TABLE[i].str,first_item);
    first_item = false;
  }

  // ScanaStudio.gui_add_new_tab("Device configuration",true);
  //   // ScanaStudio.gui_add_combo_box("res","Bit resolution");
  //   //   ScanaStudio.gui_add_item_to_combo_box("RH : 12 and T : 14",false);
  //   //   ScanaStudio.gui_add_item_to_combo_box("RH : 11 and T : 11",false);
  //   //   ScanaStudio.gui_add_item_to_combo_box("RH : 10 and T : 13",false);
  //   //   ScanaStudio.gui_add_item_to_combo_box("RH : 08 and T : 12",false);
  //
  // ScanaStudio.gui_end_tab();

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
      ScanaStudio.gui_add_check_box("en_noise_flter", "Ignore high-frequency noise on data and clock lines", false);
  ScanaStudio.gui_end_tab();
}

//Global variables
var device_write;
var device_read;
var device_8b_addr;
var device_grp = 1;
var objCnt; //not used?
var decBuf; //not used?
var I2Cdata; //not used?
var Device; //not used?
var noACK = false;
var start_packet = true;
var last_end_state = false;
var tmp_int = 0;
var before_data = false;
var RH = false;
var T = false;
var Register = false;
var temp_1st_byte = true;
var Temp_MSB;
var Temp_LSB;
var frame_state = I2C_FRAME.ADDRESS;
var next_frame_state = I2C_FRAME.CMD;
var data_word;
var word_start_sample = 0;

function on_decode_signals(resume)
{
  if (!resume) //If resume == false, it's the first call to this function.
  {
      uiDevice = ScanaStudio.gui_get_value("uiDevice");
      address_opt = ScanaStudio.gui_get_value("address_opt");
      address_format = ScanaStudio.gui_get_value("address_format");
      data_format = ScanaStudio.gui_get_value("data_format");
      device_8b_addr = DEVICE_TABLE[uiDevice].code;
      device_grp = DEVICE_TABLE[uiDevice].grp;
      update_cmd_database();
  }

  var i2c_items = ScanaStudio.pre_decode("i2c.js",resume);
  var i = 0;
  for (i = 0; i < i2c_items.length; i++)
  {
    if (ScanaStudio.abort_is_requested() == true)
		{
			return false;
		}
    process_i2c_item(i2c_items[i]);
  }
}

function process_i2c_item(item)
{
  ScanaStudio.dec_item_new(item.channel_index,item.start_sample_index,item.end_sample_index);

  if (item.content.indexOf("RE-START") >= 0)
  {
    ScanaStudio.dec_item_add_content("RE-START");
    ScanaStudio.dec_item_add_content("RS");
    ScanaStudio.dec_item_add_content("R");
    ScanaStudio.packet_view_add_packet(false, item.channel_index, item.start_sample_index, item.end_sample_index, "Re-start", "", ScanaStudio.PacketColors.Wrap.Title, ScanaStudio.PacketColors.Wrap.Content);
    frame_state = I2C_FRAME.ADDRESS;
  }
  else if (item.content.indexOf("START") >= 0)
  {
    ScanaStudio.dec_item_add_content("START");
    ScanaStudio.dec_item_add_content("S");
  	ScanaStudio.packet_view_add_packet(true, item.channel_index, item.start_sample_index, -1, "I2C Sensor", "CH" + (item.channel_index + 1), ScanaStudio.get_channel_color(item.channel_index), ScanaStudio.get_channel_color(item.channel_index));
  	ScanaStudio.packet_view_add_packet(false, item.channel_index, item.start_sample_index, item.end_sample_index, "Start", "", ScanaStudio.PacketColors.Wrap.Title, ScanaStudio.PacketColors.Wrap.Content);

    frame_state = I2C_FRAME.ADDRESS;
  }
  else if (item.content.indexOf("STOP") >= 0)
  {
    ScanaStudio.dec_item_add_content("STOP");
    ScanaStudio.dec_item_add_content("P");
    ScanaStudio.packet_view_add_packet(false, item.channel_index, item.start_sample_index, item.end_sample_index, "Stop", "",ScanaStudio.PacketColors.Wrap.Title, ScanaStudio.PacketColors.Wrap.Content);
    frame_state = I2C_FRAME.ADDRESS;
    //We have a full packet, process it:
  }
  else if (item.content.indexOf("NACK") >= 0)
  {
    ScanaStudio.dec_item_add_content("NACK");
    ScanaStudio.dec_item_add_content("N");
    ScanaStudio.packet_view_add_packet(false, item.channel_index, item.start_sample_index, item.end_sample_index, "NACK", "", ScanaStudio.PacketColors.Error.Title, ScanaStudio.PacketColors.Error.Content);
    frame_state = I2C_FRAME.ADDRESS;
    if (frame_state == I2C_FRAME.CHKSUM)
    {
      next_frame_state = I2C_FRAME.CMD;
    }
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
      case I2C_FRAME.ADDRESS:
        if (byte == 0) //General call
        {
          operation_str = "General call addr ";
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
          operation_str = "SMBus Alert response addr ";
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
            operation_str = "NOT SUPPORTED: Rd from 10bit addr ";
            operation_str_short = "! 10R ";
            ScanaStudio.dec_item_emphasize_warning();
          }
          else
          {
            operation_str = "NOT SUPPORTED: Wr to 10bit addr ";
            operation_str_short = "! 10W ";
            ScanaStudio.dec_item_emphasize_warning();
          }
        }
        else if (((byte>>1) == 2) || ((byte>>1) == 3) || ((byte>>3) == 0x1F)) //Reserved
        {
          operation_str = "Reserved / address ";
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

        ScanaStudio.dec_item_add_content(operation_str + format_content(byte >> add_shift,address_format,add_len) + " - R/W = " + (byte & 0x1).toString());
        ScanaStudio.dec_item_add_content(operation_str + format_content(byte >> add_shift,address_format,add_len));
        ScanaStudio.dec_item_add_content(operation_str_short + format_content(byte >> add_shift,address_format,add_len));
        ScanaStudio.dec_item_add_content(format_content(byte >> add_shift,address_format,add_len));

        var packet_str = operation_str + format_content(byte >> add_shift,address_format,add_len);
        if (packet_str.length > ScanaStudio.PacketMaxWidth.Content)
        {
          ScanaStudio.packet_view_add_packet(false, item.channel_index, item.start_sample_index, item.end_sample_index, "Address",
                           operation_str, ScanaStudio.PacketColors.Preamble.Title, ScanaStudio.PacketColors.Preamble.Content);
          ScanaStudio.packet_view_add_packet(false, item.channel_index, item.start_sample_index, item.end_sample_index, "Address",
                           format_content(byte >> add_shift,address_format,add_len),
                           ScanaStudio.PacketColors.Preamble.Title, ScanaStudio.PacketColors.Preamble.Content);
        }
        else
        {
          ScanaStudio.packet_view_add_packet(false, item.channel_index, item.start_sample_index, item.end_sample_index, "Address",
                           packet_str, ScanaStudio.PacketColors.Preamble.Title, ScanaStudio.PacketColors.Preamble.Content);
        }

        frame_state = next_frame_state;
        break;
      case I2C_FRAME.CMD:
        var c;
        var last_i2c_cmd = null;
        frame_state = I2C_FRAME.ADDRESS;
        next_frame_state = I2C_FRAME.DATA_MSB;
        for (c = 0; c < i2c_cmd_db.length; c++)
        {
          if (i2c_cmd_db[c].code == byte)
          {
            ScanaStudio.dec_item_add_content("Cmd = "
                                              + format_content(byte,data_format,8)
                                              + ": " + i2c_cmd_db[c].name
                                            );
            ScanaStudio.dec_item_add_content("Cmd = "
                                              + format_content(byte,data_format,8)
                                              + ": " + i2c_cmd_db[c].name_short
                                            );
            ScanaStudio.dec_item_add_content(format_content(byte,data_format,8) + " " + i2c_cmd_db[c].name_short);
            ScanaStudio.dec_item_add_content(format_content(byte,data_format,8));
            ScanaStudio.packet_view_add_packet(false,item.channel_index,item.start_sample_index,item.end_sample_index,"Command",i2c_cmd_db[c].name,ScanaStudio.PacketColors.Head.Title,ScanaStudio.PacketColors.Head.Content);
            last_i2c_cmd = i2c_cmd_db[c];
			if(byte == 0xfe)//SOFT RESET
			{
		        frame_state = I2C_FRAME.ADDRESS;
		        next_frame_state = I2C_FRAME.CMD;
			}
            break;
          }
        }
        if (last_i2c_cmd == null)
        {
          ScanaStudio.dec_item_add_content("Unknown command: " + format_content(byte,data_format,8) + "?");
          ScanaStudio.dec_item_add_content(format_content(byte,data_format,8) + "?");
          ScanaStudio.dec_item_add_content("?");
          ScanaStudio.dec_item_emphasize_warning();
          ScanaStudio.packet_view_add_packet(false,item.channel_index,item.start_sample_index,item.end_sample_index,"Command","Unknown!",ScanaStudio.PacketColors.Error.Title,ScanaStudio.PacketColors.Error.Content);
        }
        break;
      case I2C_FRAME.DATA_MSB:
        data_word = (byte << 8);
        ScanaStudio.dec_item_add_content("Data (MSB) = " + format_content(byte,data_format,8));
        ScanaStudio.dec_item_add_content(format_content(byte,data_format,8));
        frame_state = I2C_FRAME.DATA_LSB;
        next_frame_state = I2C_FRAME.CMD;
        word_start_sample = item.start_sample_index;
        break;
      case I2C_FRAME.DATA_LSB:
        data_word = data_word | byte;
        var measure;
        var measure_type;
        //Last two LSBs define the measurement type
        if ((byte & 0x03) == 0) //temperature
        {
          measure = get_value_temperature(data_word) + " °C";
          measure_type = "(T)";
        }
        else if ((byte & 0x03) == 2) //Humidity
        {
          measure = get_value_rh(data_word) + " %";
          measure_type = "(RH)";
        }
        else // ??
        {
          measure = data_word + "(Unknown / unvalid LSB)"
          measure_type = "(?)";
        }
        ScanaStudio.dec_item_add_content("Data (LSB) = " + format_content(byte,data_format,8) + ", Measure = " + measure);
        ScanaStudio.dec_item_add_content(measure);
        ScanaStudio.packet_view_add_packet(false, item.channel_index, word_start_sample, item.end_sample_index, "Measure " + measure_type,measure, ScanaStudio.PacketColors.Data.Title, ScanaStudio.PacketColors.Data.Content);
        frame_state = I2C_FRAME.CHKSUM;
        next_frame_state = I2C_FRAME.CMD;
        break;
      case I2C_FRAME.CHKSUM:
        frame_state = I2C_FRAME.ADDRESS;
        next_frame_state = I2C_FRAME.CMD;
        break;
      case I2C_FRAME.DATA_MSB:
        break;
      default:
    }
  }

  ScanaStudio.dec_item_end();
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

function get_value_temperature (word)
{
	var result = 0;
	var tmp = 0;

  tmp = word / (Math.pow(2, 16));
  tmp *= 175.72;
  result = tmp - 46.85;
  result = Math.round(result * 100) / 100
	return result
}

function get_value_rh (word)
{
	var result = 0;
	var tmp = 0;

  tmp = word / (Math.pow(2, 16));
  tmp *= 125;
  result = tmp - 6;
  result = Math.round(result * 100) / 100
	return result
}
