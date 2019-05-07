/* Protocol meta info:
<NAME> PMBus </NAME>
<DESCRIPTION>
PMBus protocol analyzer
</DESCRIPTION>
<VERSION> 0.1 </VERSION>
<AUTHOR_NAME>  Ibrahim KAMAL </AUTHOR_NAME>
<AUTHOR_URL> i.kamal@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright Ibrahim KAMAL </COPYRIGHT>
<LICENSE>  This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.1:  Initial release.
</RELEASE_NOTES>
*/

/*
Future releases
~~~~~~~~~~~~~~~~
* Add pre-decoding support (done, to be tested)
* Write online documentation
* Add hex view support
* Add packet view support
*/

var SMB =
{
	ADDRESS : 0x01,
  CMD : 0x02,
	DATA  : 0x04,
};

//Decoder GUI
function on_draw_gui_decoder()
{
  ScanaStudio.gui_add_ch_selector("ch_sda","SMBDAT Channel","SMBDAT");
  ScanaStudio.gui_add_ch_selector("ch_scl","SMBCLK Channel","SMBCLK");

  ScanaStudio.gui_add_new_tab("Advanced options",false);
    ScanaStudio.gui_add_check_box("pec_enable","Analyze last byte as PEC",true);
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
      sampling_rate = ScanaStudio.get_capture_sample_rate();
      pec_enable = ScanaStudio.gui_get_value("pec_enable");
      address_opt = ScanaStudio.gui_get_value("address_opt");
      address_format = ScanaStudio.gui_get_value("address_format");
      data_format = ScanaStudio.gui_get_value("data_format");
      frame_state = SMB.ADDRESS;
      sm_data_bytes = [];
  }

  items = ScanaStudio.pre_decode("i2c.js",resume);
  var i;
  for (i = 0; i < items.length; i++)
  {
    items[i].pec = false; //Assume this is not the PEC byte
    sm_data_bytes.push(items[i]);
    //If SM packet is finished, process it
    if (items[i].content.indexOf("STOP") >= 0)
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
        process_pm_item(sm_data_bytes[n]);
      }
      sm_data_bytes = [];
    }
  }
}

function process_pm_item(item)
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

        ScanaStudio.dec_item_add_content(operation_str + format_content(byte >> add_shift,address_format,add_len) + " - R/W = " + (byte & 0x1).toString());
        ScanaStudio.dec_item_add_content(operation_str + format_content(byte >> add_shift,address_format,add_len));
        ScanaStudio.dec_item_add_content(operation_str_short + format_content(byte >> add_shift,address_format,add_len));
        ScanaStudio.dec_item_add_content(format_content(byte >> add_shift,address_format,add_len));

        frame_state = SMB.CMD;

        crc8_calc(byte);
        break;
      case SMB.CMD:
        if (!isNaN(byte))
        {
          ScanaStudio.dec_item_add_content("PM Bus command: " + PMB_COMMANDS[byte] + " (" + format_content(byte,data_format,8) + ")");
          ScanaStudio.dec_item_add_content(PMB_COMMANDS[byte] + " (" + format_content(byte,data_format,8) + ")");
          ScanaStudio.dec_item_add_content(format_content(byte,data_format,8));
        }
        frame_state = SMB.DATA;
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
      default:
    }
  }
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

var PMB_COMMANDS =
[
"PAGE",
"OPERATION",
"ON_OFF_CONFIG",
"CLEAR_FAULTS",
"PHASE",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"WRITE_PROTECT",
"STORE_DEFAULT_ALL",
"RESTORE_DEFAULT_ALL",
"STORE_DEFAULT_CODE",
"RESTORE_DEFAULT_CODE",
"STORE_USER_ALL",
"RESTORE_USER_ALL",
"STORE_USER_CODE",
"RESTORE_USER_CODE",
"CAPABILITY",
"QUERY",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"VOUT_MODE",
"VOUT_CMD",
"VOUT_TRIM",
"VOUT_CAL_OFFSET",
"VOUT_MAX",
"VOUT_MARGIN_HIGH",
"VOUT_MARGIN_LOW",
"VOUT_TRANSITION_RATE",
"VOUT_DROOP",
"VOUT_SCALE_LOOP",
"VOUT_SCALE_MONITOR",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"COEFFICIENTS",
"POUT_MAX",
"MAX_DUTY",
"FREQUENCY_SWITCH",
"Reserved",
"VIN_ON",
"VIN_OFF",
"INTERLEAVE",
"IOUT_CAL_GAIN",
"IOUT_CAL_OFFSET",
"FAN_CONFIG_1_2",
"FAN_CMD_1",
"FAN_CMD_2",
"FAN_CONFIG_3_4",
"FAN_CMD_3",
"FAN_CMD_4",
"VOUT_OV_FAULT_LIMIT",
"VOUT_OV_FAULT_RESPONSE",
"VOUT_OV_WARN_LIMIT",
"VOUT_UV_WARN_LIMIT",
"VOUT_UV_FAULT_LIMIT",
"VOUT_UV_FAULT_RESPONSE",
"IOUT_OC_FAULT_LIMIT",
"IOUT_OC_FAULT_RESPONSE",
"IOUT_OC_LV_FAULT_LIMIT",
"IOUT_OC_LV_FAULT_RESPONSE",
"IOUT_OC_WARN_LIMIT",
"IOUT_UC_FAULT_LIMIT",
"IOUT_UC_FAULT_RESPONSE",
"Reserved",
"Reserved",
"OT_FAULT_LIMIT",
"OT_FAULT_RESPONSE",
"OT_WARN_LIMIT",
"UT_WARN_LIMIT",
"UT_FAULT_LIMIT",
"UT_FAULT_RESPONSE",
"VIN_OV_FAULT_LIMIT",
"VIN_OV_FAULT_RESPONSE",
"VIN_OV_WARN_LIMIT",
"VIN_UV_WARN_LIMIT",
"VIN_UV_FAULT_LIMIT",
"VIN_UV_FAULT_RESPONSE",
"IIN_OC_FAULT_LIMIT",
"IIN_OC_FAULT_RESPONSE",
"IIN_OC_WARN_LIMIT",
"POWER_GOOD_ON",
"POWER_GOOD_OFF",
"TON_DELAY",
"TON_RISE",
"TON_MAX_FAULT_LIMIT",
"TON_MAX_FAULT_RESPONSE",
"TOFF_DELAY",
"TOFF_FALL",
"TOFF_MAX_WARN_LIMIT",
"Reserved",
"POUT_OP_FAULT_LIMIT",
"POUT_OP_FAULT_RESPONSE",
"POUT_OP_WARN_LIMIT",
"PIN_OP_WARN_LIMIT",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"STATUS_BYTE",
"STATUS_WORD",
"STATUS_VOUT",
"STATUS_IOUT",
"STATUS_INPUT",
"STATUS_TEMPERATURE",
"STATUS_CML",
"STATUS_OTHER",
"STATUS_MFR_SPECIFIC",
"STATUS_FANS_1_2",
"STATUS_FANS_3_4",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"READ_VIN",
"READ_IIN",
"READ_VCAP",
"READ_VOUT",
"READ_IOUT",
"READ_TEMPERATURE_1",
"READ_TEMPERATURE_2",
"READ_TEMPERATURE_3",
"READ_FAN_SPEED_1",
"READ_FAN_SPEED_2",
"READ_FAN_SPEED_3",
"READ_FAN_SPEED_4",
"READ_DUTY_CYCLE",
"READ_FREQUENCY",
"READ_POUT",
"READ_PIN",
"PMBUS_REVISION",
"MFR_ID",
"MFR_MODEL",
"MFR_REVISION",
"MFR_LOCATION",
"MFR_DATE",
"MFR_SERIAL",
"Reserved",
"MFR_VIN_MIN",
"MFR_VIN_MAX",
"MFR_IIN_MAX",
"MFR_PIN_MAX",
"MFR_VOUT_MIN",
"MFR_VOUT_MAX",
"MFR_IOUT_MAX",
"MFR_POUT_MAX",
"MFR_TAMBIENT_MAX",
"MFR_TAMBIENT_MIN",
"MFR_EFFICIENCY_LL",
"MFR_EFFICIENCY_HL",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"USER_DATA_00",
"USER_DATA_01",
"USER_DATA_02",
"USER_DATA_03",
"USER_DATA_04",
"USER_DATA_05",
"USER_DATA_06",
"USER_DATA_07",
"USER_DATA_08",
"USER_DATA_09",
"USER_DATA_10",
"USER_DATA_11",
"USER_DATA_12",
"USER_DATA_13",
"USER_DATA_14",
"USER_DATA_15",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"Reserved",
"MFR_SPECIFIC_00",
"MFR_SPECIFIC_01",
"MFR_SPECIFIC_02",
"MFR_SPECIFIC_03",
"MFR_SPECIFIC_04",
"MFR_SPECIFIC_05",
"MFR_SPECIFIC_06",
"MFR_SPECIFIC_07",
"MFR_SPECIFIC_08",
"MFR_SPECIFIC_09",
"MFR_SPECIFIC_10",
"MFR_SPECIFIC_11",
"MFR_SPECIFIC_13",
"MFR_SPECIFIC_14",
"MFR_SPECIFIC_15",
"MFR_SPECIFIC_16",
"MFR_SPECIFIC_17",
"MFR_SPECIFIC_18",
"MFR_SPECIFIC_19",
"MFR_SPECIFIC_20",
"MFR_SPECIFIC_21",
"MFR_SPECIFIC_22",
"MFR_SPECIFIC_23",
"MFR_SPECIFIC_24",
"MFR_SPECIFIC_25",
"MFR_SPECIFIC_26",
"MFR_SPECIFIC_27",
"MFR_SPECIFIC_28",
"MFR_SPECIFIC_29",
"MFR_SPECIFIC_30",
"MFR_SPECIFIC_31",
"MFR_SPECIFIC_32",
"MFR_SPECIFIC_33",
"MFR_SPECIFIC_34",
"MFR_SPECIFIC_35",
"MFR_SPECIFIC_36",
"MFR_SPECIFIC_37",
"MFR_SPECIFIC_38",
"MFR_SPECIFIC_39",
"MFR_SPECIFIC_40",
"MFR_SPECIFIC_41",
"MFR_SPECIFIC_42",
"MFR_SPECIFIC_43",
"MFR_SPECIFIC_44",
"MFR_SPECIFIC_45",
"MFR_SPECIFIC_CMD_EXT",
"PMBUS_CMD_EXT"
];



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
