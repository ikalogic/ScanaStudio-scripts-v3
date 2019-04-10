/* Protocol meta info:
<NAME> FDX-B </NAME>
<DESCRIPTION>
My protocol can decode pretty much any logic signal!
</DESCRIPTION>
<VERSION> 0.0 </VERSION>
<AUTHOR_NAME>  Victor Canoz </AUTHOR_NAME>
<AUTHOR_URL> v.canoz@ikalogic.com</AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright Victor Canoz </COPYRIGHT>
<LICENSE>  This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.0:  Initial release.
</RELEASE_NOTES>
*/

function crc16(bytes) {
  crc = 0;
  polynomial = 0x1021;
  for (j=0;j<bytes.length;j++)
  {
      b = bytes[j];
      for (i = 0; i < 8; i++)
      {
          bit = ((b >> (7 - i) & 1) == 1);
          c15 = ((crc >> 15 & 1) == 1);
          crc <<= 1;
          if (c15 ^ bit) crc ^= polynomial;
      }
  }
  crc &= 0xffff;
  return crc;
}

//Decoder GUI
function on_draw_gui_decoder()
{
  //Define decoder configuration GUI
  ScanaStudio.gui_add_ch_selector("ch","Select channel to decode","FDX-B");
  ScanaStudio.gui_add_info_label("FDX-B is an Animal Identification data format. Carrier frequency is 134.2kHz while data bitrate is set at 134.2/32 = 4.19375kHz. This high level decoder uses Scanastudio's biphase encoding decoder. Refer to ISO 11784/5 for more information.")

  ScanaStudio.gui_add_new_selectable_containers_group("th_source","Select timing source");
    ScanaStudio.gui_add_new_container("Use FDX-B standard biphase encoding baudrate",false);
      ScanaStudio.gui_add_info_label("(1/(134.2kHz/32))*3/4 => 178.84 µs pulse width threshold");
    ScanaStudio.gui_end_container();
    ScanaStudio.gui_add_new_container("Use external clock source",false);
      ScanaStudio.gui_add_ch_selector("ch_clk","Select clock source","FDX-B clock");
      ScanaStudio.gui_add_info_label("Threshold pulse width will be calculated by dividing clock frequency by 32, as stated by the FDX-B standard\nNot implemented yet");
    ScanaStudio.gui_end_container();
  ScanaStudio.gui_end_selectable_containers_group();
  //Add hidden elements for the FDX-B decoder
  var carrier_frequency = 134.2e3;
  var pulse_width = (1/(carrier_frequency/32))*3/4; //=> refer to biphase encoding
  ScanaStudio.gui_add_hidden_field("th",pulse_width.toString(10));
}

var states = {"waiting_header":1, "getting_data":2, "checking":3, "parsing":4, "optional_data":5};
var state_machine;

//header
var last_11_bits;
var header_cnt;
var header = 1024;
var data_len = 10*9;
var data_len_without_control_bits = 10*8;

//data
var data;
var data_cnt;
var data_without_control_bits;
var data_without_control_bits_cnt;
var bytes;
var bytes_cnt;

function on_decode_signals(resume)
{
  if (!resume) //If resume == false, it's the first call to this function.
  {
    //initialization code goes here, ex:
    ScanaStudio.console_info_msg("FDX-B decoder initialized");
    sampling_rate = ScanaStudio.get_capture_sample_rate();
    ch = ScanaStudio.gui_get_value("ch");
    th = ScanaStudio.gui_get_value("th");
    last_11_bits = 0;
    header_cnt = 0;
    state_machine = "waiting_header";
  }
  var biphase_items = ScanaStudio.pre_decode("biphase_encoding.js",resume);

  for (i = 0; i < biphase_items.length; i++)
  {
    switch (state_machine)
    {
      case "waiting_header":
        if (header_cnt >= 11)
        {
          //remove first bit
          tmp = last_11_bits;
          last_11_bits = last_11_bits>>10;
          last_11_bits = last_11_bits<<10;
          last_11_bits = tmp-last_11_bits;
        }
        //add the new bit
        last_11_bits = (last_11_bits << 1)+Number(biphase_items[i].content);
        if (last_11_bits == header)
        {
          ScanaStudio.dec_item_new(ch,biphase_items[i-10].start_sample_index,biphase_items[i].end_sample_index);
          ScanaStudio.dec_item_add_content("Header (‭010000000000‬)");
          ScanaStudio.dec_item_add_content("Header");
          header_cnt = 0;
          last_11_bits = 0;
          data_cnt = 0;
          data = [];
          ScanaStudio.console_info_msg("Found header at "+ScanaStudio.engineering_notation(biphase_items[i].end_sample_index/sampling_rate,3)+" s");
          state_machine = "getting_data";
        }
        header_cnt++;
        break;

      case "getting_data":
        data[data_cnt] = biphase_items[i].content;
        if (data_cnt >= data_len-1)
        {
          ScanaStudio.dec_item_new(ch,biphase_items[i-data_len+1].start_sample_index,biphase_items[i].end_sample_index);
          ScanaStudio.dec_item_add_content("Data");
          data_without_control_bits_cnt = 0;
          data_without_control_bits = [];
          bytes = [];
          bytes_cnt = 0;
          state_machine = "checking";
        }
        data_cnt++;
        break;

      case "checking":
        var ok = true;
        //Checking control bits and remove them
        for (j = 0; j < data_len; j++)
        {
          if ((j % 9 == 0) || (j == 0))
          {
            if (data[j] != "1")
            {
              ok = false;
              ScanaStudio.console_warning_msg("Corrupted message: wrong control bit");
              state_machine = "waiting_header";
              break;
            }
          }
          else
          {
            data_without_control_bits[data_without_control_bits_cnt++] = data[j];
          }
        }

        //Group bits by bytes
        for (j = 0; j < data_len_without_control_bits; j+=8)
        {
          binary_str = "";
          for (k = 0; k <8; k++) //Data received is LSB first, however, we have to use it as it is for the CRC calculation
          {
            binary_str += data_without_control_bits[j+k];
          }
          bytes[j/8] = parseInt(binary_str, 2);
          //ScanaStudio.console_info_msg("bytes[" + (j/8) + "] = " + binary_str + " = " + bytes[j/8]);
        }

        //Check checksum
        var data_to_check = bytes.slice(0,8);
        var computed_crc = crc16(data_to_check);
        var read_crc = (bytes[8]<<8)|(bytes[9]);

        if (computed_crc == read_crc)
        {
          ScanaStudio.console_info_msg("Valid frame (CRC = 0x"+read_crc.toString(16)+")");
        }
        else {
          ScanaStudio.console_warning_msg("Corrupted message: wrong CRC");
          ScanaStudio.console_info_msg("Computed CRC16-CCITT of incoming data is 0x" + computed_crc.toString(16));
          ScanaStudio.console_info_msg("CRC read from the data is 0x" + read_crc.toString(16));
        }
        state_machine = "parsing";
        break;

      case "parsing":

        break;
    }
  }
}
