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

//Decoder GUI
function on_draw_gui_decoder()
{
  //Define decoder configuration GUI
  ScanaStudio.gui_add_ch_selector("ch","Select channel to decode","FDX-B");
  ScanaStudio.gui_add_info_label("FDX-B is an Animal Identification data format. Carrier frequency is 134.2kHz while data bitrate is set at 134.2/32 = 4.19375kHz. This high level decoder uses Scanastudio's biphase encoding decoder. Refer to ISO 11784/5 for more information.")

  //Add hidden elements for the FDX-B decoder
  ScanaStudio.gui_add_hidden_field("th","178.83755588673621460506706408346e-6"); // (1/(134.2kHz/32))*3/4 => refer to biphase encoding
}

var states = {"waiting_header":1, "getting_array":2, "checking":3, "parsing":4};
var state_machine;
var last_11_bits;
var header_cnt;
var header = 1024;

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
          header_cnt = 0;
          last_11_bits = 0;
          state_machine = "getting_array";
          ScanaStudio.console_info_msg("Found header at "+ScanaStudio.engineering_notation(biphase_items[i].end_sample_index/sampling_rate,3)+" s");
        }
        header_cnt++;
        break;
      case "getting_array":
        //ScanaStudio.console_info_msg("Getting array");
        break;
      case "checking":
        //ScanaStudio.console_info_msg("Checking parity");
        break;
      case "parsing":
        //ScanaStudio.console_info_msg("Parsing data");
        break;
    }
  }
}
