/* Protocol meta info:
<NAME> CSV importer </NAME>
<DESCRIPTION>
Build signals from a CSV file.
</DESCRIPTION>
<VERSION> 0.1 </VERSION>
<AUTHOR_NAME>  Ibrahim KAMAL </AUTHOR_NAME>
<AUTHOR_URL> your@email.or.website </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki/CSV-importer-script-documentation </HELP_URL>
<COPYRIGHT> Copyright Ibrahim KAMAL </COPYRIGHT>
<LICENSE>  This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.1:  Initial release.
</RELEASE_NOTES>
*/

var ENCODING = "UTF-8";

//Signal builder GUI
function on_draw_gui_signal_builder()
{
  ScanaStudio.gui_add_file_load("csv_file","CSV File","*.csv");
  ScanaStudio.gui_add_check_box("skip_first_line","Skip first line (used as header)",true);

  ScanaStudio.gui_add_new_selectable_containers_group("csv_structure","Select CSV file structure");
    ScanaStudio.gui_add_new_container("1 sample per line (fixed period per line)",false);
      ScanaStudio.gui_add_info_label("Each line should contain sample value (1 or 0). "+
      "e.g.:\n"+
      "0 ; 1 ; 1 ; 0\n0 ; 1 ; 1 ; 0\n0 ; 1 ; 1 ; 1");
      ScanaStudio.gui_add_engineering_form_input_box("csv_period","Sampling period",1e-9,1,"100e-6","s");
    ScanaStudio.gui_end_container();
    ScanaStudio.gui_add_new_container("1 or more transitions per line",true);
      ScanaStudio.gui_add_info_label("A column in the CSV file should contain absolute time (expressed in seconds), other columns should contain one or more transition(s), e.g.:\n0.123 ; 0 ; 1 ; 1 ; 0\n0.241 ; 0 ; 0 ; 1 ; 0");
      ScanaStudio.gui_add_combo_box("col_time","Time column");
      for (col = 0; col <= ScanaStudio.get_device_channels_count(); col++)
      {
        ScanaStudio.gui_add_item_to_combo_box("Column "+(col).toString(), ((col == 0)?true:false));
      }
    ScanaStudio.gui_end_container();
  ScanaStudio.gui_end_selectable_containers_group();


  ScanaStudio.gui_add_new_tab("CSV Mapping",false);
    var ch;
    for (ch = 0; ch < ScanaStudio.get_device_channels_count(); ch++)
    {
      ScanaStudio.gui_add_combo_box("col_ch"+ch,"CH " + (ch+1).toString());
      ScanaStudio.gui_add_item_to_combo_box("Do not import",false);
      for (col = 0; col <= ScanaStudio.get_device_channels_count(); col++)
      {
        ScanaStudio.gui_add_item_to_combo_box("Column "+(col).toString(), ((col == (ch+1))?true:false));
      }
    }
  ScanaStudio.gui_end_tab();
  ScanaStudio.gui_add_new_tab("CSV format",false);
    ScanaStudio.gui_add_text_input("sep","Column separator",";");
    ScanaStudio.gui_add_combo_box("time_format","Time format");
    ScanaStudio.gui_add_item_to_combo_box("12.3");
    ScanaStudio.gui_add_item_to_combo_box("12,3");
  ScanaStudio.gui_end_tab();

}

//Evaluate signal builder GUI
function on_eval_gui_signal_builder()
{
  //TODO: verify sample time yields at least 1 sample
  var csv_structure = ScanaStudio.gui_get_value("csv_structure");
  if ((csv_structure==0) && (ScanaStudio.gui_get_value("csv_period") == 0))
  {
    return "Invalid CSV sample period";
  }
  if (ScanaStudio.gui_get_value("sep").length != 1)
  {
    return "Invalid separator character";
  }
  var file = ScanaStudio.file_system_open("csv_file","r");
  if (file < 0)
  {
    return "Invalid CSV file";
  }

  var separator = ScanaStudio.gui_get_value("sep");
  var file = ScanaStudio.file_system_open("csv_file","r");
  var data = ScanaStudio.file_system_read_text(file,ENCODING);;
  ScanaStudio.file_system_close(file);
  var lines = data.match(/[^\r\n]+/g);
  if (lines.length < 1)
  {
    return "This file seems empty";
  }
  var cols = lines[0].split(separator);
  var biggest_col_number = 0;
  for (ch = 0; ch < ScanaStudio.get_device_channels_count(); ch++)
  {
    col_ch = ScanaStudio.gui_get_value("col_ch"+ch) - 1;
    if (col_ch > biggest_col_number) biggest_col_number = col_ch;
  }
  if (biggest_col_number >= cols.length )
  {
    return "CSV file don't have enough columns. At least " + (biggest_col_number+1).toString() + "columns needed";
  }

  var sample_rate = ScanaStudio.builder_get_sample_rate();
  var delta_time = ScanaStudio.gui_get_value("csv_period");
  var delta_samples = Math.round(delta_time*sample_rate);
  if (delta_samples == 0)
  {
    return "CSV Sampling period too high for the selected device sampling rate. Please reduce CSV sampling rate or increase device sampling rate.";
  }

  return "" //All good.
}

//Function called to build siganls (to be generate by capable device)
function on_build_signals()
{
  //Use the function below to get the number of samples to be built
  var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
  var sample_rate = ScanaStudio.builder_get_sample_rate();
  var max_time = samples_to_build / sample_rate;
  var csv_structure = ScanaStudio.gui_get_value("csv_structure");
  var separator = ScanaStudio.gui_get_value("sep");
  var file = ScanaStudio.file_system_open("csv_file","r");
  var data = ScanaStudio.file_system_read_text(file,ENCODING);;
  var lines = data.match(/[^\r\n]+/g);
  ScanaStudio.file_system_close(file);
  var ch_map = [];
  var last_trs_samp_index = [];
  var last_trs_val = [];
  var ch;
  for (ch = 0; ch < ScanaStudio.get_device_channels_count(); ch++)
  {
    ch_map.push(ScanaStudio.gui_get_value("col_ch"+ch)-1);
    last_trs_samp_index.push(0);
    last_trs_val.push(-1);
    //ScanaStudio.console_info_msg("ch_map["+ch+"]="+ch_map[ch]);
  }
  var samples_acc = 0;
  var csv_invalid = false;
  var i = 0;
  if (ScanaStudio.gui_get_value("skip_first_line") == true) i = 1;
  for (; i < lines.length; i++)
  {
    var cols = lines[i].split(separator);
    var new_line = "";
    if (csv_invalid) break;
    //process one line:
    if (csv_structure == 1)
    {
      trs_time = parseFloat(cols[0]);
      //ScanaStudio.console_info_msg("trs_time="+trs_time + "cols[0]="+cols[0]);
      if (trs_time > max_time) break;
      trs_sample = Math.ceil(trs_time*sample_rate);
      for (ch = 0; ch < ScanaStudio.get_device_channels_count(); ch++)
      {
        if (ch_map[ch] != -1)
        {
          trs_val = parseInt(cols[ch_map[ch]]);
          if (last_trs_val[ch] != trs_val)
          {
            last_trs_val[ch] = trs_val;
            trs_val = trs_val ^ 0x1;
            if (trs_sample < last_trs_samp_index[ch])
            {
              ScanaStudio.console_error_msg("Invalid time in CSV file at line:" + (i+1).toString());
              csv_invalid = true;
              break;
            }
            ScanaStudio.builder_add_samples(ch,trs_val,trs_sample - last_trs_samp_index[ch]);
            //ScanaStudio.console_info_msg("ch"+ch+":"+trs_time+":"+trs_sample+":"+trs_val+"/"+last_trs_samp_index[ch]);
            last_trs_samp_index[ch] = trs_sample;
          }
        }
      }
    }
    else //1 sample per line
    {
      var delta_time = ScanaStudio.gui_get_value("csv_period");
      var delta_samples = Math.round(delta_time*sample_rate);
      samples_acc += delta_samples;
      if (samples_acc > samples_to_build)
      {
        break;
      }
      for (ch = 0; ch < ScanaStudio.get_device_channels_count(); ch++)
      {
        if (ch_map[ch] != -1)
        {
          sample_val = parseInt(cols[ch_map[ch]]);
          ScanaStudio.builder_add_samples(ch,sample_val,delta_samples);
        }
      }
    }

  }

}
