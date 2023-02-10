/* Protocol meta info:
<NAME> CSV import </NAME>
<DESCRIPTION>
Build signals from a CSV file.
</DESCRIPTION>
<VERSION> 0.3 </VERSION>
<AUTHOR_NAME> Camille Perrin</AUTHOR_NAME>
<AUTHOR_URL> contact@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki/CSV-importer-script-documentation </HELP_URL>
<COPYRIGHT> Copyright IKALOGIC SAS </COPYRIGHT>
<LICENSE> This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.3:  Now can be used by SP1000G series (Pattern generator).
V0.2:  Improved separator and time format and last transition.
V0.1:  Initial release.
</RELEASE_NOTES>
*/

/*DEFINES THE ENCODING USED TO READ THE FILE IN TEXT FORMAT*/

var ENCODING = "UTF-8";

/*---------------------------------------------------------------------------------------------------------------------------------------------------------------*/
/*---------------------------------------------------------------------------------------------------------------------------------------------------------------*/
/*                                                                        SIGNAL BUILDER                                                                         */
/*---------------------------------------------------------------------------------------------------------------------------------------------------------------*/
/*---------------------------------------------------------------------------------------------------------------------------------------------------------------*/

/*-------------------------------------------------------------------------------------------------------------------------------------------------------*/
/*CONSTRUCTION OF THE "WELCOME MENU" WHEN THE SCRIPT IS LAUNCHED ON SCANASTUDIO : THE USER IS ASKED TO SET SOME VALUES, WHICH WILL BE USED IN THIS SCRIPT*/
/*-------------------------------------------------------------------------------------------------------------------------------------------------------*/

function on_draw_gui_signal_builder()
{
  /*CSV FILE CHOICE*/

  ScanaStudio.gui_add_file_load("csv_file","CSV File","*.csv");
  ScanaStudio.gui_add_check_box("skip_first_line","Skip first line (used as header)",true);

  /*WHETHER THE TIME IS INDICATED OR NOT IN CSV FILE*/

  ScanaStudio.gui_add_new_selectable_containers_group("csv_structure","Select CSV file structure");
      ScanaStudio.gui_add_new_container("1 sample per line (fixed period per line)",false);
          ScanaStudio.gui_add_info_label( "Each line should contain sample value (1 or 0). "+
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

  /*LINK BETWEEN CHANNELS COLUMN ON CSV AND CHANNELS ON SCANASTUDIO*/

  ScanaStudio.gui_add_new_tab("CSV Mapping",false);
      var ch;
      for (ch = 0; ch < ScanaStudio.get_device_channels_count(); ch++)
      {
          ScanaStudio.gui_add_combo_box("col_ch"+ch,"CH " + (ch+1).toString());
              ScanaStudio.gui_add_item_to_combo_box("Do not import",false);
              for (col = 0; col <= ScanaStudio.get_device_channels_count(); col++)
              {
                  ScanaStudio.gui_add_item_to_combo_box("Column "+(col).toString(), ((col == (ch))?true:false));
              }
      }

  ScanaStudio.gui_end_tab();

  /*SEPARATOR AND TIME FORMAT USED IN CSV*/

  ScanaStudio.gui_add_new_tab("CSV format",false);
      ScanaStudio.gui_add_combo_box("sep","Column separator");
          ScanaStudio.gui_add_item_to_combo_box(";");
          ScanaStudio.gui_add_item_to_combo_box(",");
          ScanaStudio.gui_add_item_to_combo_box("Tabulation");
          ScanaStudio.gui_add_item_to_combo_box("Space");
      ScanaStudio.gui_add_combo_box("time_format","Time format");
          ScanaStudio.gui_add_item_to_combo_box("12.3");
          ScanaStudio.gui_add_item_to_combo_box("12,3");
      ScanaStudio.gui_end_tab();
}

/*---------------------------------------------------------------------------------------------*/
/*CALLED WHEN SCANASTUDIO NEEDS TO EVALUATE IF THE SIGNAL BUILDER GUI CONFIGURATION IS VALID*/
/*---------------------------------------------------------------------------------------------*/

function on_eval_gui_signal_builder()
{
    var csv_structure = ScanaStudio.gui_get_value("csv_structure");
    if ((csv_structure==0) && (ScanaStudio.gui_get_value("csv_period") == 0))
    {
        return "Invalid CSV sample period";
    }

    var file = ScanaStudio.file_system_open(ScanaStudio.gui_get_value("csv_file"),"r");
    if (file < 0)
    {
        return "Invalid CSV file " + file;
    }

    var separator = ";";
    switch(ScanaStudio.gui_get_value("sep"))
    {
        default:
        case 0:
            separator = ";";
            break;
        case 1:
            separator = ",";
            break;
        case 2:
            separator = "\t";
            break;
        case 3:
            separator = " ";
            break;
    }

    var file = ScanaStudio.file_system_open(ScanaStudio.gui_get_value("csv_file"),"r");
    var data = ScanaStudio.file_system_read_text(file,ENCODING);
    ScanaStudio.file_system_close(file);
    var lines = data.match(/[^\r\n]+/g);

    if (lines.length < 1)
    {
        return "This file seems empty";
    }

    var time_column = ScanaStudio.gui_get_value("col_time");

    if (csv_structure==1) //csv with time
    {
        for (ch = 0; ch < ScanaStudio.get_device_channels_count(); ch++)
        {
            col_ch = ScanaStudio.gui_get_value("col_ch" + ch) - 1;
            if (time_column==col_ch)
            {
                return ("The column assigned to time is also assigned to another channel.");
            }
        }
    }

    var sample_rate = ScanaStudio.builder_get_sample_rate();
    var delta_time = ScanaStudio.gui_get_value("csv_period");
    var delta_samples = Math.round(delta_time*sample_rate);
    if (delta_samples == 0)
    {
        return ("CSV Sampling period too high for the selected device sampling rate. Please reduce CSV sampling rate or increase device sampling rate.");
    }

    /*INDICATED WHICH CHANNEL IS CLOSED/OPEN*/

    var cols = lines[0].split(separator);
    var number_of_opened_channels =0;

    for (ch = 0; ch < ScanaStudio.get_device_channels_count(); ch++)
    {
        col_ch = ScanaStudio.gui_get_value("col_ch" + ch) - 1; //col_ch = selected column for a channel
        if (col_ch ==-1)                                       //if for a channel, column "not imported", col_ch=-1
        {
            ScanaStudio.console_info_msg("channel " + (ch+1) + " is closed");
        }
        else
        {
            ScanaStudio.console_info_msg("channel " + (ch+1) + " is opened");
            number_of_opened_channels+=1;
        }
    }

    ScanaStudio.console_info_msg("Number of opened channels : " + number_of_opened_channels);

    return ""; //All good.
}

/*------------------------------------------*/
/*FUNCTION WHICH BUILDS AND GENERATES SIGNAL*/
/*------------------------------------------*/

function on_build_signals()
{
    /*USE THE FUNCTION BELOW TO GET NUMBER OF SAMPLES TO BE BUILT*/

    var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
    var sample_rate = ScanaStudio.builder_get_sample_rate();
    var max_time = samples_to_build / sample_rate;
    var csv_structure = ScanaStudio.gui_get_value("csv_structure");

    /*ATTRIBUTION SEPERATOR VALUE DEPENDING ON USER CHOICE*/

    var separator = ";";
    switch(ScanaStudio.gui_get_value("sep"))
    {
        default:
        case 0:
            separator = ";";
            break;
        case 1:
            separator = ",";
            break;
        case 2:
            separator = "\t";
            break;
        case 3:
            separator = " ";
            break;
    }

    /*READING CSV*/

    var time_format = ScanaStudio.gui_get_value("time_format");
    var file = ScanaStudio.file_system_open(ScanaStudio.gui_get_value("csv_file"),"r");
    var data = ScanaStudio.file_system_read_text(file,ENCODING);;
    var lines = data.match(/[^\r\n]+/g);
    ScanaStudio.file_system_close(file);

    /*VARIABLES DECLARATION*/

    var ch_map = [];
    var last_trs_samp_index = [];
    var last_trs_val = [];
    var ch;

    /*CONSTRUCTION OF CH_MAP, WHICH CONTAINS THE NUMBER OF COLUMN FOR EACH CHANNELS (=-1 IF NOT IMPORTED)*/

    for (ch = 0; ch < ScanaStudio.get_device_channels_count(); ch++)
    {
        ch_map.push(ScanaStudio.gui_get_value("col_ch"+ch)-1);
        last_trs_samp_index.push(0);
        last_trs_val.push(-1);
    }

    var samples_acc = 0;
    var csv_invalid = false;
    var i = 0;
    if (ScanaStudio.gui_get_value("skip_first_line") == true) i = 1;

    for (; i < lines.length; i++)
    {
      var cols = lines[i].split(separator);
      var new_line = "";

      /*IF CSV FILE INVALID*/

      if (csv_invalid)
      {
        break;
      }

      /*IF CSV FILE WITH TIME*/

      if (csv_structure == 1)
      {
          trs_time = parseFloat((time_format==0 )? cols[0] : cols[0].replace(',','.'));

          if (trs_time > max_time) break;

          /*CONVERSION OF TRS_TIME TO A SAMPLE BY USING SAMPLE RATE*/

          trs_sample = Math.ceil(trs_time*sample_rate);

          for (ch = 0; ch < ScanaStudio.get_device_channels_count(); ch++)
          {
              if ((trs_sample!=NaN)||(ch_map[ch] != -1))
              {
                  trs_val = parseInt(cols[ch_map[ch]]);

                  if (last_trs_val[ch] != trs_val)
                  {
                      last_trs_val[ch] = trs_val;
                      trs_val = trs_val ^ 0x1; //trs_val set the new value at the transition (t). To set the valor during the all time (t-1 to t), ^=Xor to inverse the previous trq_val

                      /*IF THE PREVIOUS SAMPLE IS HIGHER, INVALID SAMPLE SO */
                      if (trs_sample < last_trs_samp_index[ch])
                      {
                            ScanaStudio.console_error_msg("Invalid time in CSV file at line:" + (i+1).toString());
                            csv_invalid = true;
                            break;

                      }

                      /*IF THE PREVIOUS SAMPLE IS EQUAL, NOTHING IS DONE*/
                      if (trs_sample - last_trs_samp_index[ch]==0)
                      {
                      }

                      /*IF THE SAMPLE IS HIGHER THAN THE PREVIOUS ONE, THE SAMPLE IS ADDED CHANEL N°"CH", THEN IT'S STORED IN LAST_TRS_SAMP_INDEX[CH]*/
                      else
                      {
                          ScanaStudio.builder_add_samples(ch,trs_val,trs_sample - last_trs_samp_index[ch]);
                          last_trs_samp_index[ch] = trs_sample;
                      }
                  }
              }
          }
      }

      /*IF CSV FILE WITHOUT TIME (SO TIME IS GIVEN BY SAMPLING PERIOD (GUI))*/

      else
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

              if (ch_map[ch]==-1)
              {
                  sample_val = parseInt(cols[ch_map[ch]]);
                  ScanaStudio.builder_add_samples(ch,sample_val,delta_samples);
              }
          }
      }
  }

    if (csv_structure == 1)
    {
        for (ch = 0; ch < ScanaStudio.get_device_channels_count(); ch++)
        {
            if (ch_map[ch] != -1)
            {
                if ( Math.ceil(max_time*sample_rate) - last_trs_samp_index[ch] == 0)
                {
                }
                else
                {
                    ScanaStudio.builder_add_samples(ch, last_trs_val[ch], Math.ceil(max_time*sample_rate) - last_trs_samp_index[ch]);
                }
            }
        }
    }
}

/*---------------------------------------------------------------------------------------------------------------------------------------------------------------*/
/*---------------------------------------------------------------------------------------------------------------------------------------------------------------*/
/*                                                                       PATTERN GENERATOR                                                                       */
/*---------------------------------------------------------------------------------------------------------------------------------------------------------------*/
/*---------------------------------------------------------------------------------------------------------------------------------------------------------------*/

/*-------------------------------------------------------------------------------------------------------------------------------------------------------*/
/*CONSTRUCTION OF THE "WELCOME MENU" WHEN THE SCRIPT IS LAUNCHED ON SCANASTUDIO : THE USER IS ASKED TO SET SOME VALUES, WHICH WILL BE USED IN THIS SCRIPT*/
/*-------------------------------------------------------------------------------------------------------------------------------------------------------*/

function on_draw_gui_pattern_generator()
{
  /*CSV FILE CHOICE*/

  ScanaStudio.gui_add_file_load("csv_file","CSV File","*.csv");
  ScanaStudio.gui_add_check_box("skip_first_line","Skip first line (used as header)",true);

  /*WHETHER THE TIME IS INDICATED OR NOT IN CSV FILE*/

  ScanaStudio.gui_add_new_selectable_containers_group("csv_structure","Select CSV file structure");
      ScanaStudio.gui_add_new_container("1 sample per line (fixed period per line)",false);
          ScanaStudio.gui_add_info_label( "Each line should contain sample value (1 or 0). "+
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

  /*LINK BETWEEN CHANNELS COLUMN ON CSV AND CHANNELS ON SCANASTUDIO*/

  ScanaStudio.gui_add_new_tab("CSV Mapping",false);
      var ch;
      for (ch = 0; ch < ScanaStudio.get_device_channels_count(); ch++)
      {
          ScanaStudio.gui_add_combo_box("col_ch"+ch,"CH " + (ch+1).toString());
              ScanaStudio.gui_add_item_to_combo_box("Do not import",false);
              for (col = 0; col <= ScanaStudio.get_device_channels_count(); col++)
              {
                  ScanaStudio.gui_add_item_to_combo_box("Column "+(col).toString(), ((col == (ch))?true:false));
              }
      }

  ScanaStudio.gui_end_tab();

  /*SEPARATOR AND TIME FORMAT USED IN CSV*/

  ScanaStudio.gui_add_new_tab("CSV format",false);
      ScanaStudio.gui_add_combo_box("sep","Column separator");
          ScanaStudio.gui_add_item_to_combo_box(";");
          ScanaStudio.gui_add_item_to_combo_box(",");
          ScanaStudio.gui_add_item_to_combo_box("Tabulation");
          ScanaStudio.gui_add_item_to_combo_box("Space");
      ScanaStudio.gui_add_combo_box("time_format","Time format");
          ScanaStudio.gui_add_item_to_combo_box("12.3");
          ScanaStudio.gui_add_item_to_combo_box("12,3");
      ScanaStudio.gui_end_tab();

  /*ELECTRICAL CHOICES*/

  ScanaStudio.gui_add_new_tab("Electrical choices",false);
      /*Voltage choice*/
            ScanaStudio.gui_add_text_input("Volt","Voltage output (mV)","3300");
      /*Idle choice*/
            ScanaStudio.gui_add_combo_box("Idle","Idle state");
            ScanaStudio.gui_add_item_to_combo_box("0");
            ScanaStudio.gui_add_item_to_combo_box("1");
      /*IO choice*/
            ScanaStudio.gui_add_combo_box("IO","I/O type");
            ScanaStudio.gui_add_item_to_combo_box("Push pull");
            ScanaStudio.gui_add_item_to_combo_box("Open drain - no pull");
            ScanaStudio.gui_add_item_to_combo_box("Open drain - pull up");
            ScanaStudio.gui_add_item_to_combo_box("Floating");
      ScanaStudio.gui_end_tab();
}

/*---------------------------------------------------------------------------------------------*/
/*CALLED WHEN SCANASTUDIO NEEDS TO EVALUATE IF THE PATTERN GENERATOR GUI CONFIGURATION IS VALID*/
/*---------------------------------------------------------------------------------------------*/

function on_eval_gui_pattern_generator()
{
    var csv_structure = ScanaStudio.gui_get_value("csv_structure");
    if ((csv_structure==0) && (ScanaStudio.gui_get_value("csv_period") == 0))
    {
        return "Invalid CSV sample period";
      }

    var file = ScanaStudio.file_system_open(ScanaStudio.gui_get_value("csv_file"),"r");
    if (file < 0)
    {
        return "Invalid CSV file " + file;
    }

    var separator = ";";
    switch(ScanaStudio.gui_get_value("sep"))
    {
        default:
        case 0:
            separator = ";";
            break;
        case 1:
            separator = ",";
            break;
        case 2:
            separator = "\t";
            break;
        case 3:
            separator = " ";
            break;
    }

    var file = ScanaStudio.file_system_open(ScanaStudio.gui_get_value("csv_file"),"r");
    var data = ScanaStudio.file_system_read_text(file,ENCODING);
    ScanaStudio.file_system_close(file);
    var lines = data.match(/[^\r\n]+/g);

    if (lines.length < 1)
    {
        return "This file seems empty";
    }

    var time_column = ScanaStudio.gui_get_value("col_time");

    if (csv_structure==1) //csv with time
    {
        for (ch = 0; ch < ScanaStudio.get_device_channels_count(); ch++)
        {
            col_ch = ScanaStudio.gui_get_value("col_ch" + ch) - 1;
            if (time_column==col_ch)
            {
                return ("The column assigned to time is also assigned to another channel.");
            }
        }
    }

    var sample_rate = ScanaStudio.builder_get_sample_rate();
    var delta_time = ScanaStudio.gui_get_value("csv_period");
    var delta_samples = Math.round(delta_time*sample_rate);
    if (delta_samples == 0)
    {
        return ("CSV Sampling period too high for the selected device sampling rate. Please reduce CSV sampling rate or increase device sampling rate.");
    }

    /*INDICATED WHICH CHANNELS IS CLOSED/OPEN*/

    var cols = lines[0].split(separator);
    var number_of_opened_channels =0;

    for (ch = 0; ch < ScanaStudio.get_device_channels_count(); ch++)
    {
        col_ch = ScanaStudio.gui_get_value("col_ch" + ch) - 1; //col_ch = selected column for a channel
        if (col_ch ==-1)                                       //if for a channel, column "not imported", col_ch=-1
        {
            ScanaStudio.console_info_msg("channel " + (ch+1) + " is closed");
        }
        else
        {
            ScanaStudio.console_info_msg("channel " + (ch+1) + " is opened");
            number_of_opened_channels+=1;
        }
    }

    ScanaStudio.console_info_msg("Number of opened channels : " + number_of_opened_channels);

    return ""; //All good.
}

/*------------------------------------------*/
/*FUNCTION WHICH BUILDS AND GENERATES SIGNAL*/
/*------------------------------------------*/

function on_pattern_generate()
{
    var val_IO = ScanaStudio.io_type.push_pull;
    switch(ScanaStudio.gui_get_value("IO"))
    {
      default:
      case 0:
          val_IO = ScanaStudio.io_type.push_pull;
          break;
      case 1:
          val_IO = ScanaStudio.io_type.open_drain_no_pull;
          break;
      case 2:
          val_IO = ScanaStudio.io_type.open_drain_pull_up;
          break;
      case 3:
          val_IO = ScanaStudio.io_type.floating;
          break;
  }

    var val_idle = 0;
    switch(ScanaStudio.gui_get_value("Idle"))
    {
        default:
        case 0:
            val_idle = 0;
            break;
        case 1:
            val_idle = 1;
            break;
    }

    /*USE THE FUNCTION BELOW TO GET NUMBER OF SAMPLES TO BE BUILT*/

    var samples_to_build = ScanaStudio.builder_get_max_chunk_size();
    var sample_rate = ScanaStudio.builder_get_sample_rate();
    var csv_structure = ScanaStudio.gui_get_value("csv_structure");

    /*ATTRIBUTION SEPERATOR VALUE DEPENDING ON USER CHOICE*/

    var separator = ";";
    switch(ScanaStudio.gui_get_value("sep"))
    {
        default:
        case 0:
            separator = ";";
            break;
        case 1:
            separator = ",";
            break;
        case 2:
            separator = "\t";
            break;
        case 3:
            separator = " ";
            break;
    }

    /*READING CSV*/

    var time_format = ScanaStudio.gui_get_value("time_format");
    var file = ScanaStudio.file_system_open(ScanaStudio.gui_get_value("csv_file"),"r");
    var data = ScanaStudio.file_system_read_text(file,ENCODING);;
    var lines = data.match(/[^\r\n]+/g);
    ScanaStudio.file_system_close(file);

    /*VARIABLES DECLARATION*/

    var ch_map = [];
    var last_trs_samp_index = [];
    var last_trs_val = [];
    var ch;
    var samples_acc = 0;
    var csv_invalid = false;
    var i = 0;
    var compteur=0
    var first_chunk=true;

    /*CONSTRUCTION OF CH_MAP, WHICH CONTAINS THE NUMBER OF COLUMN FOR EACH CHANNELS (=-1 IF NOT IMPORTED)*/

    for (ch = 0; ch < ScanaStudio.get_device_channels_count(); ch++)
    {
        ch_map.push(ScanaStudio.gui_get_value("col_ch"+ch)-1);
        last_trs_samp_index.push(0);
        last_trs_val.push(-1);
    }

    /*ELECTRICAL SETTINGS*/

    for (ch=0;ch<ScanaStudio.get_device_channels_count();ch++)
    {
        if (ch_map[ch] == -1)
        {
        }
        else
        {
            ScanaStudio.builder_set_out_voltage(ch, ScanaStudio.gui_get_value("Volt"));
            ScanaStudio.builder_set_idle_state(ch,val_idle);
            ScanaStudio.builder_set_io(ch, val_IO);
        }
    }

    if (ScanaStudio.gui_get_value("skip_first_line") == true)
    {
      i = 1;
    }

    /*DATA*/

    for (; i < lines.length; i++)
    {
      var cols = lines[i].split(separator);
      var new_line = "";

      /*IF CSV FILE INVALID*/

      if (csv_invalid)
      {
          break;
      }

      /*IF CSV FILE WITH TIME*/

      if (csv_structure == 1)
      {
          trs_time = parseFloat((time_format==0 )? cols[0] : cols[0].replace(',','.'));
          samples_acc+=1;

          if (samples_acc>ScanaStudio.builder_get_max_chunk_size()*0.45)
          {
              if(first_chunk==true) //first chunk
              {
                  compteur+=1;
                  first_chunk=false;
              }

              else
              {
                  ScanaStudio.builder_wait_done(500);
                  compteur+=1;
              }

              ScanaStudio.builder_start_chunk();
              ScanaStudio.console_info_msg("chunk number " +compteur+" sent");
              samples_acc=0;
          }

          /*CONVERSION OF TRS_TIME TO A SAMPLE BY USING SAMPLE RATE*/

          trs_sample = Math.ceil(trs_time*sample_rate);

          for (ch = 0; ch < ScanaStudio.get_device_channels_count(); ch++)
          {
              if ((trs_sample!=NaN)||(ch_map[ch] != -1))
              {
                  trs_val = parseInt(cols[ch_map[ch]]);
                    if (last_trs_val[ch] != trs_val)
                    {
                        last_trs_val[ch] = trs_val;
                        trs_val = trs_val ^ 0x1; //trs_val set the new value at the transition (t). To set the valor during the all time (t-1 to t), ^=Xor to inverse the previous trq_val

                        /*IF THE PREVIOUS SAMPLE IS HIGHER, INVALID SAMPLE SO */
                        if (trs_sample < last_trs_samp_index[ch])
                        {
                              ScanaStudio.console_error_msg("Invalid time in CSV file at line:" + (i+1).toString());
                              csv_invalid = true;
                              break;
                        }

                        /*IF THE PREVIOUS SAMPLE IS EQUAL, NOTHING IS DONE*/
                        if (trs_sample - last_trs_samp_index[ch]==0)
                        {
                        }

                        /*IF THE SAMPLE IS HIGHER THAN THE PREVIOUS ONE, THE SAMPLE IS ADDED CHANEL N°"CH", THEN IT'S STORED IN LAST_TRS_SAMP_INDEX[CH]*/
                        else
                        {
                          ScanaStudio.builder_add_samples(ch, last_trs_val[ch], trs_sample-last_trs_samp_index[ch]);
                          last_trs_samp_index[ch] = trs_sample;
                        }
                    }
                  }
              }
      }


      /*IF CSV FILE WITHOUT TIME (SO TIME IS GIVEN BY SAMPLING PERIOD (GUI))*/

      else
      {
          var delta_time = ScanaStudio.gui_get_value("csv_period");
          var delta_samples = Math.round(delta_time*sample_rate);
          samples_acc += 1;

          if (samples_acc>ScanaStudio.builder_get_max_chunk_size()*0.45)
          {
              if(first_chunk==true) //first chunk
              {
                  compteur+=1;
                  first_chunk=false;
              }

              else
              {
                  ScanaStudio.builder_wait_done(500);
                  compteur+=1;
              }
              samples_acc=0;
              ScanaStudio.builder_start_chunk();
              ScanaStudio.console_info_msg("chunk number " +compteur+" sent");
          }

          for (ch = 0; ch < ScanaStudio.get_device_channels_count(); ch++)
          {
              sample_val = parseInt(cols[ch_map[ch]]);
              if ((ch_map[ch]==-1)||(sample_val==NaN))
              {
              }

              else
              {
                  ScanaStudio.builder_add_samples(ch,sample_val,delta_samples);
              }
          }
      }
    }

  if (csv_structure == 1)
  {
      for (ch = 0; ch < ScanaStudio.get_device_channels_count(); ch++)
      {
          if ((ch_map[ch] != -1)||(trs_sample!=NaN))
          {
              if (trs_sample - last_trs_samp_index[ch]==0)
              {
              }
              else
              {
                ScanaStudio.builder_add_samples(ch,  last_trs_val[ch], trs_sample-last_trs_samp_index[ch]);
                ScanaStudio.builder_start_chunk();
              }
          }
      }
  }

  if (compteur ==0)
  {
  }
  else
  {
      ScanaStudio.builder_wait_done(500);
  }

  ScanaStudio.builder_set_repeat_count(1);
  ScanaStudio.builder_start_chunk();
  ScanaStudio.builder_wait_done(500);
  ScanaStudio.console_info_msg("Last chunk sent");

}
