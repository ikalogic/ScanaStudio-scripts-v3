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
  var i;
  var crc = 0;
  var polynomial = 0x1021;
  for (j = 0; j < bytes.length; j++) {
    b = bytes[j];
    for (i = 0; i < 8; i++) {
      bit = ((b >> (7 - i) & 1) == 1);
      var c15 = ((crc >> 15 & 1) == 1);
      crc <<= 1;
      if (c15 ^ bit) crc ^= polynomial;
    }
  }
  crc &= 0xffff;
  return crc;
}

//Decoder GUI
function on_draw_gui_decoder() {
  //Define decoder configuration GUI
  ScanaStudio.gui_add_ch_selector("ch", "Select channel to decode", "FDX-B");
  ScanaStudio.gui_add_info_label("FDX-B is an Animal Identification data format. Carrier frequency is 134.2kHz while data bitrate is set at 134.2/32 = 4.19375kHz. This high level decoder uses Scanastudio's biphase encoding decoder. Refer to ISO 11784/5 for more information.")

  ScanaStudio.gui_add_new_selectable_containers_group("th_source", "Select timing source");
  ScanaStudio.gui_add_new_container("Use FDX-B standard biphase encoding baudrate", false);
  ScanaStudio.gui_add_info_label("(1/(134.2kHz/32))*3/4 => 178.84 µs pulse width threshold");
  ScanaStudio.gui_end_container();
  ScanaStudio.gui_add_new_container("Use external clock source", false);
  ScanaStudio.gui_add_ch_selector("ch_clk", "Select clock source", "FDX-B clock");
  ScanaStudio.gui_add_info_label("Threshold pulse width will be calculated by dividing clock frequency by 32, as stated by the FDX-B standard\nNot implemented yet");
  ScanaStudio.gui_end_container();
  ScanaStudio.gui_end_selectable_containers_group();
  //Add hidden elements for the FDX-B decoder
  var carrier_frequency = 134.2e3;
  var pulse_width = (1 / (carrier_frequency / 32)) * 3 / 4; //=> refer to biphase encoding
  ScanaStudio.gui_add_hidden_field("th", pulse_width.toString(10));
}

var states = {
  "waiting_header": 1,
  "getting_data": 2,
  "checking": 3,
  "parsing": 4,
  "getting_extended_data": 5,
  "parsing_extended_data": 6
};
var state_machine;

//Constants
var header = 1024;
var data_len = 10 * 9;
var data_len_without_control_bits = 10 * 8;
var extended_data_len = 3 * 9;
var extended_data_len_without_control_bits = 3 * 8;
var flags_offset = 6 * 9;
var crc_offset = 8 * 9;
var extra_data_offset = 10 * 9;

//variables
var last_11_bits;
var header_cnt;
var data;
var data_cnt;
var data_without_control_bits;
var data_without_control_bits_cnt;
var bytes;
var bytes_cnt;

//items
var tag_number_and_country_idx;

function array_to_int(array) {
  var buf = 0;
  var i;
  for (i = 0; i < 4; i++) {
    buf = buf | (array[i] << (8 * i));
  }
  if (buf < 0) {
    buf &= 0x7FFFFFFF;
    buf += Math.pow(2, 31);
  }
  return buf;
}

function int_array_to_double(big, little) {
  // combine the two 32-bit values
  var combined = little + Math.pow(2, 32) * big;

  if (combined >= Math.pow(2, 57)) {
    ScanaStudio.console_error_msg("Number exceeds MAX_SAFE_INTEGER. Precision may be lost");
  }

  return combined;
}

function byte_reverse(byte) {
  var buf = 0;
  byte &= 0xFF;
  var i;
  for (i = 0; i < 8; i++) {
    var bit = 0;
    bit = (byte >> i) & 1;
    buf |= (bit << (7 - i));
  }
  return buf;
}

function on_decode_signals(resume) {
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
  var biphase_items = ScanaStudio.pre_decode("biphase_encoding.js", resume);

  var i;
  for (i = 0; i < biphase_items.length; i++) {

    switch (state_machine) {
      case "waiting_header":
        if (header_cnt >= 11) {
          //remove first bit
          tmp = last_11_bits;
          last_11_bits = last_11_bits >> 10;
          last_11_bits = last_11_bits << 10;
          last_11_bits = tmp - last_11_bits;
        }
        //add the new bit
        last_11_bits = (last_11_bits << 1) + Number(biphase_items[i].content);
        if (last_11_bits == header) {
          ScanaStudio.dec_item_new(ch, biphase_items[i - 10].start_sample_index, biphase_items[i].end_sample_index);
          ScanaStudio.dec_item_add_content("Header (‭010000000000‬)");
          ScanaStudio.dec_item_add_content("Header");
          header_cnt = 0;
          last_11_bits = 0;
          data_cnt = 0;
          data = [];
          tag_number_and_country_idx = i + 1;
          ScanaStudio.console_info_msg("Found header at " + ScanaStudio.engineering_notation(biphase_items[i].end_sample_index / sampling_rate, 3) + " s");
          state_machine = "getting_data";
        }
        header_cnt++;
        break;

      case "getting_data":
        data[data_cnt] = biphase_items[i].content;
        if (data_cnt >= data_len - 1) {
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
        for (j = 0; j < data_len; j++) {
          if ((j % 9 == 0) || (j == 0)) {
            if (data[j] != "1") {
              ok = false;
              ScanaStudio.console_warning_msg("Corrupted message: wrong control bit");
              state_machine = "waiting_header";

              ScanaStudio.dec_item_new(ch, biphase_items[tag_number_and_country_idx + j].start_sample_index, biphase_items[tag_number_and_country_idx + j].end_sample_index);
              ScanaStudio.dec_item_add_content("Bad control bit!");
              ScanaStudio.dec_item_add_content("Bad!");

              break;
            }
          } else {
            data_without_control_bits[data_without_control_bits_cnt++] = data[j];
          }
        }
        if (ok) {
          ScanaStudio.console_info_msg("Control bits OK");
        }

        //Group bits by bytes
        for (j = 0; j < data_len_without_control_bits; j += 8) {
          binary_str = "";
          for (k = 0; k < 8; k++) //Data received is LSB first, however, we have to use it as it is for the CRC calculation
          {
            binary_str += data_without_control_bits[j + k];
          }
          bytes[j / 8] = parseInt(binary_str, 2);
          //ScanaStudio.console_info_msg("bytes[" + (j / 8) + "] = " + binary_str + " = " + bytes[j / 8]);
        }

        //Check CRC
        if (ok) {
          var data_to_check = bytes.slice(0, 8);
          var computed_crc = crc16(data_to_check);
          var read_crc = (bytes[8] << 8) | (bytes[9]);

          if (computed_crc == read_crc) {
            ScanaStudio.console_info_msg("Valid FDX-B frame (CRC = 0x" + read_crc.toString(16) + ")");

          } else {
            ok = false;
            ScanaStudio.console_warning_msg("Corrupted message: wrong CRC", biphase_items[tag_number_and_country_idx + crc_offset].start_sample_index);
            ScanaStudio.console_info_msg("Computed CRC16-CCITT of incoming data is 0x" + computed_crc.toString(16));
            ScanaStudio.console_info_msg("CRC read from the data is 0x" + read_crc.toString(16));

            ScanaStudio.dec_item_new(ch, biphase_items[tag_number_and_country_idx + crc_offset].start_sample_index, biphase_items[tag_number_and_country_idx + crc_offset + 16].end_sample_index);
            ScanaStudio.dec_item_add_content("BAD CRC: computed CRC16-CCITT = 0x" + computed_crc.toString(16) + "| CRC read = 0x" + read_crc.toString(16));
          }
        }
        if (ok) state_machine = "parsing";
        else state_machine = "waiting_header";
        break;

      case "parsing":
        //Read ID & country code
        var id = data_to_check.slice(0, 5);
        id[4] &= 0xFC; //remove country code from ID

        //Reverse bits order
        var l;
        for (l = 0; l < 5; l++) {
          id[l] = byte_reverse(id[l]);
        }

        //36 bit ID calculation
        var low = array_to_int(id.slice(0, 4));
        var high = array_to_int(id.slice(4, 5));
        var resultID = int_array_to_double(high, low);

        //Country code calculation
        var country = data_to_check.slice(4, 6);
        country[0] &= 0x3; //remove ID bits
        for (l = 0; l < 2; l++) {
          country[l] = byte_reverse(country[l]);
        }
        var resultCountry = 0;
        resultCountry = (country[1] << 2) | (country[0] >> 6);

        ScanaStudio.dec_item_new(ch, biphase_items[tag_number_and_country_idx].start_sample_index, biphase_items[tag_number_and_country_idx + flags_offset - 1].end_sample_index);
        ScanaStudio.dec_item_add_content("ID = " + resultID + " | Country code = " + resultCountry);
        ScanaStudio.dec_item_add_content("ID + Country code");

        //Read Animal & Status bit
        var status_bit = (bytes[6] >> 7) & 1;
        var animal_bit = bytes[7] & 1;
        ScanaStudio.dec_item_new(ch, biphase_items[tag_number_and_country_idx + flags_offset].start_sample_index, biphase_items[tag_number_and_country_idx + crc_offset - 1].end_sample_index);
        ScanaStudio.dec_item_add_content("Flags: Status bit = " + status_bit + " | Animal bit = " + animal_bit);
        ScanaStudio.dec_item_add_content("Flags");

        //Display CRC
        if (ok) {
          ScanaStudio.dec_item_new(ch, biphase_items[tag_number_and_country_idx + crc_offset].start_sample_index, biphase_items[tag_number_and_country_idx + extra_data_offset - 1].end_sample_index);
          ScanaStudio.dec_item_add_content("CRC OK ( = 0x" + read_crc.toString(16) + " )");
          ScanaStudio.dec_item_add_content("CRC OK");
          ScanaStudio.dec_item_add_content("CRC");
        }
        if (status_bit) {
          state_machine = "waiting_header";
        } else {
          state_machine = "getting_extended_data";
          data_cnt = 0;
          data = [];
        }
        break;

      case "getting_extended_data":
        data[data_cnt] = biphase_items[i].content;
        ScanaStudio.console_info_msg("extended_data[" + data_cnt + "] = " + data[data_cnt]);
        if (data_cnt >= extended_data_len - 1) {
          extended_data_len_without_control_bits_cnt = 0;
          extended_data_len_without_control_bits = [];
          bytes = [];
          bytes_cnt = 0;
          state_machine = "parsing_extended_data";
        }
        data_cnt++;
        break;

      case "parsing_extended_data":
        for (j = 0; j < extended_data_len; j++) {
          if ((j % 9 == 0) || (j == 0)) {
            //ScanaStudio.console_info_msg("extended_data["+j+"] = "+ data[j]);
            // if (data[j] != "1") {
            //   ScanaStudio.console_warning_msg("Corrupted message: wrong control bit");
            //   state_machine = "waiting_header";
            //
            //   ScanaStudio.dec_item_new(ch, biphase_items[tag_number_and_country_idx + extra_data_offset + j].start_sample_index, biphase_items[tag_number_and_country_idx + extra_data_offset + j].end_sample_index);
            //   ScanaStudio.dec_item_add_content("Bad control bit!");
            //   ScanaStudio.dec_item_add_content("Bad!");
            //
            //   break;
            // }
          } else {
            data_without_control_bits[data_without_control_bits_cnt++] = data[j];
          }
        }
        break;
    }
  }
}
