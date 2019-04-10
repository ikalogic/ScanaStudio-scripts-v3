/* Protocol meta info:
<NAME> Biphase Encoding </NAME>
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
  tmin= 10/ScanaStudio.get_capture_sample_rate()
  ScanaStudio.gui_add_ch_selector("ch","Select channel to decode","Biphase encoding")
  ScanaStudio.gui_add_engineering_form_input_box("th","Threshold pulse width",tmin,1,177e-6,"s")
  //Add other gui functions...
}

//Evaluate decoder GUI
function on_eval_gui_decoder()
{
  return "" //All good.
}

//Global variables
var sampling_rate;

function on_decode_signals(resume)
{
  if (!resume) //If resume == false, it's the first call to this function.
  {
      //initialization code goes here, ex:
      sampling_rate = ScanaStudio.get_capture_sample_rate();
      ch = ScanaStudio.gui_get_value("ch");
      th = ScanaStudio.gui_get_value("th");
      last_edge = -1;
      last_zero_start_idx = -1;
      last_zero_start_cnt = -1;
      trscnt = 0;
      ScanaStudio.console_info_msg("Biphase Encoding decoder initialized");
      ScanaStudio.console_info_msg("Decoding channel "+ch+1);
      ScanaStudio.console_info_msg("Threshold pulse width = "+ScanaStudio.engineering_notation(th,3)+"s");

      ScanaStudio.trs_reset(ch); //reset the trs iterator.
  }

  while (ScanaStudio.abort_is_requested() == false)
  {
    if (!ScanaStudio.trs_is_not_last(ch))
    {
      break;
    }
      trs = ScanaStudio.trs_get_next(ch);
      if (trscnt>1) //if it's not the very first edge
      {
        pulse_width = (trs.sample_index - last_edge) / sampling_rate; //period in [s]

        //ScanaStudio.dec_item_add_content(ScanaStudio.engineering_notation(pulse_width,3) + "s");
        if (pulse_width>th)
        {
          ScanaStudio.dec_item_new(ch,last_edge,trs.sample_index);
          ScanaStudio.dec_item_add_content("1");
        }
        else {
          if (last_zero_start_cnt == trscnt-1)
          {
            ScanaStudio.dec_item_new(ch,last_zero_start_idx,trs.sample_index);
            ScanaStudio.dec_item_add_content("0");
          }
          else
          {
            last_zero_start_cnt = trscnt;
            last_zero_start_idx = last_edge;
          }
        }
      }
      last_edge = trs.sample_index
      trscnt++;
  }
}
