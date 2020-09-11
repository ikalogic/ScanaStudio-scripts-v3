/* Protocol meta info:
<NAME> SDIO </NAME>
<DESCRIPTION>
SDIO Bus Decoder
</DESCRIPTION>
<VERSION> 1.00 </VERSION>
<AUTHOR_NAME> Corentin Maravat </AUTHOR_NAME>
<AUTHOR_URL> contact@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright Ikalogic SAS </COPYRIGHT>
<LICENSE> This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V1.00:  Initial release.
</RELEASE_NOTES>
*/

/* Sources (les plus importantes c'est surtout les 2 premières après le problème c'est qu'elles sont relativement longue)
SD Specifications 7.10 : https://www.sdcard.org/downloads/pls/pdf/index.php?p=Part1_Physical_Layer_Simplified_Specification_Ver7.10.jpg&f=Part1_Physical_Layer_Simplified_Specification_Ver7.10.pdf&e=EN_SS1
SDIO Specifications 3.00 : https://www.sdcard.org/downloads/pls/pdf/index.php?p=PartE1_SDIO_Simplified_Specification_Ver3.00.jpg&f=PartE1_SDIO_Simplified_Specification_Ver3.00.pdf&e=EN_SSE1
Les CMD du protocole SD (elle y sont pas forcément toute car c'est pas la Version 7.1) : http://www.zeroplus.com.tw/software_download/Protocol%20Analyzer%20SD%20Introduction_Table_.pdf
Site d'un mec qui explique le protocole SDIO : https://yannik520.github.io/sdio.html
Site qui parle du protocole SD : http://wiki.seabright.co.nz/wiki/SdCardProtocol.html
Blog d'un mec qui utilse le bus SDIO, yavais des exemples de trames : https://iosoft.blog/2020/03/08/zerowi-part2/
La aussi il y avait des trames : https://esp32.com/viewtopic.php?t=6813
Encore sur le protocole SDIO : http://wiki.csie.ncku.edu.tw/embedded/SDIO
Pin des cartes SD : https://openlabpro.com/guide/interfacing-microcontrollers-with-sd-card/
Des timings sur la clk : https://e2e.ti.com/support/interface/f/138/t/532916
wiki sur le CRC en général : https://en.wikipedia.org/wiki/Cyclic_redundancy_check
Site qui donne des exemples de réponses du CRC7 et du CRC16 du protocole SD : https://bits4device.wordpress.com/2017/12/16/sd-crc7-crc16-implementation/
Le code du CRC-7 je l'ai pris ici (transfo en javascript): https://www.pololu.com/docs/0J1?section=5.f
Le code du CRC-16 je l'ai pris ici (XMODEM): https://cs.stackexchange.com/questions/119017/replacing-0x1021-polynomial-with-0x8005-in-this-crc-16-code
*/

//Decoder GUI
function on_draw_gui_decoder()
{
  //Define decoder configuration GUI
  ScanaStudio.gui_add_ch_selector("ch_cmd","CMD Channel","CMD");
  ScanaStudio.gui_add_ch_selector("ch_clk","CLK Channel","CLK");
  ScanaStudio.gui_add_ch_selector("ch_dat0","DAT0 Channel","DAT0");
  if (ScanaStudio.get_device_channels_count() > 4)
  {
      ScanaStudio.gui_add_combo_box( "quad_DAT", "Number of data pin");
      ScanaStudio.gui_add_item_to_combo_box( "DAT[0] pin only", true);
      ScanaStudio.gui_add_item_to_combo_box( "4 data pins (DAT[0-3])");
      ScanaStudio.gui_add_new_tab("DATA Channel",false);
      ScanaStudio.gui_add_ch_selector("ch_dat1","DAT1 Channel","DAT1");
      ScanaStudio.gui_add_ch_selector("ch_dat2","DAT2 Channel","DAT2");
      ScanaStudio.gui_add_ch_selector("ch_dat3","DAT3 Channel","DAT3");
      ScanaStudio.gui_end_tab();
  }

  ScanaStudio.gui_add_new_tab("SDIO Mode configuration",false);
  ScanaStudio.gui_add_check_box("SDIO","SDIO Only Card ",false);
  ScanaStudio.gui_add_check_box("DDR","DDR50 Mode (Data sample on every edge)",false);
  ScanaStudio.gui_add_check_box("CQ","CQ Mode Enable (Physical Layer 6.00 minimum)",false);
  ScanaStudio.gui_add_text_input("CMD53_block_size","Initial value of CMD53_block_size","512");
  ScanaStudio.gui_add_info_label("This value of block_size will be valid for the 0 (CIA) and 1-7, I/O functions.\n"
  + "If you want to change the block_size after the beginning of the record, "
  + "use the CMD52 with the correct register adress, "
  + "however it will change it only for the function specified in the argument.");
  ScanaStudio.gui_end_tab();

  ScanaStudio.gui_add_new_tab("Output format",true);
  ScanaStudio.gui_add_check_box("format_hex","HEX",true);
  ScanaStudio.gui_add_check_box("format_ascii","ASCII",true);
  ScanaStudio.gui_add_check_box("format_dec","Unsigned decimal",false);
  ScanaStudio.gui_add_check_box("format_bin","Binary",false);
  ScanaStudio.gui_end_tab();


  ScanaStudio.gui_add_new_tab("HEX view options",false);
  ScanaStudio.gui_add_combo_box( "hexview_endianness", "HEX View endianness");
  ScanaStudio.gui_add_item_to_combo_box( "Big Endian (MSB at lowest address)", true);
  ScanaStudio.gui_add_item_to_combo_box( "Little Endian (MSB at highest address)" );
  ScanaStudio.gui_end_tab();
  //Add other gui functions...
}



//Global variables
var sampling_rate;
var state_machine;
var ch_cmd;
var ch_clk;
var nbits;
var cmd_channel = [];
var data_channels = [];
var dat_clock_polarity = 1; //Rising Edge
var CMD = -1;
var last_CMD = -1;
var CMD_mode = 0;
var last_CMD_mode = 0;
var T_bit;  //Transmitter bit
var R_type = "Undefined"; //Response type
var item_display = [];
var crc_pre_display = [];
var str_error = "";
var format_hex,format_bin,format_ascii,format_dec;
var hexview_endianness;
var last_trans = false;
var item_start_sample = 0;
var trs_data = [];
var sdio_value = 0;
var end_data_sample_index = 0;
var speed_mode = 0;
var BUS_WIDTH = 1;
var show_pdf_on_console = false;
var usual_data = true;
var STOP_TRANSMISSION = false;
// Variables used for CRC-7 calcul
var crc_calcul = [];
var data_transfer = false;
var SDIO_only = false;
var Card_is_Lock = false;
var SD_CARD_TYPE = 0;
var start_usual_data_sample = 0;
var sampling_rate_too_low = false;
// Variables used for CMD8/R7
var CMD8_Voltage = 0;
var CMD8_check_pattern = 0;
// Variables used for CMD52/CMD53/R5 (I/O Transfer)
var R_W = -1;
var RAW = -1;
var Write_data = -1;
var function_number = -1;
var register_adress = -1;
var Block_mode = -1;
// CMD53 Block Size
var Function_0_block_size_1 = 0;
var Function_0_block_size_2 = 0;
var Function_0_block_size = 0;
var Function_1_block_size_1 = 0;
var Function_1_block_size_2 = 0;
var Function_1_block_size = 0;
var Function_2_block_size_1 = 0;
var Function_2_block_size_2 = 0;
var Function_2_block_size = 0;
var Function_3_block_size_1 = 0;
var Function_3_block_size_2 = 0;
var Function_3_block_size = 0;
var Function_4_block_size_1 = 0;
var Function_4_block_size_2 = 0;
var Function_4_block_size = 0;
var Function_5_block_size_1 = 0;
var Function_5_block_size_2 = 0;
var Function_5_block_size = 0;
var Function_6_block_size_1 = 0;
var Function_6_block_size_2 = 0;
var Function_6_block_size = 0;
var Function_7_block_size_1 = 0;
var Function_7_block_size_2 = 0;
var Function_7_block_size = 0;
var block_size = 0;
// Variables used for data transfer
var Block_length = 512; //bytes
var Lock_unlock_Block_length = 512; //bytes
var Block_count = -1; //Number of block to read or write (CMD18/25)
var Block_counter = 0; // Number of block already read since CMD18/25
// Variables used for CMD5/R4
var CMD_VDD_value = -1;
var CMD_VDD_range = [];
var RSP_VDD_value = -1;
var RSP_VDD_range = [];
// Variables used for Packet View
var packet_string = "";
var types = "";
// Variables used for Commands Queue Function Commands
var CQ_enable = false;
var send_CQ = false;
// Variables used for demo signal
var current_state = "idle";
var current_state_value = 3;
var transfer = "operation not complete";

function reload_dec_gui_values()
{
    //get GUI values
    ch_cmd = ScanaStudio.gui_get_value("ch_cmd");
    ch_clk = ScanaStudio.gui_get_value("ch_clk");
    ch_dat0 = ScanaStudio.gui_get_value("ch_dat0");
    ddr = ScanaStudio.gui_get_value("DDR");
    format_hex = Number(ScanaStudio.gui_get_value("format_hex"));
    format_dec = Number(ScanaStudio.gui_get_value("format_dec"));
    format_ascii = Number(ScanaStudio.gui_get_value("format_ascii"));
    format_bin = Number(ScanaStudio.gui_get_value("format_bin"));
    hexview_endianness = Number(ScanaStudio.gui_get_value("hexview_endianness"));
    block_size = Number(ScanaStudio.gui_get_value("CMD53_block_size"));
    SDIO_only = ScanaStudio.gui_get_value("SDIO");
    CQ_enable = ScanaStudio.gui_get_value("CQ");
    if (ScanaStudio.get_device_channels_count() > 4)
    {
        ch_dat1 = ScanaStudio.gui_get_value("ch_dat1");
        ch_dat2 = ScanaStudio.gui_get_value("ch_dat2");
        ch_dat3 = ScanaStudio.gui_get_value("ch_dat3");
        speed_mode = ScanaStudio.gui_get_value("quad_DAT");
    }
}

//Evaluate decoder GUI
function on_eval_gui_decoder()
{

    var instance_name = "SDIO [";

    sdio_ch_list = [];
    sdio_ch_list.push(ScanaStudio.gui_get_value("ch_cmd"));
    sdio_ch_list.push(ScanaStudio.gui_get_value("ch_clk"));
    sdio_ch_list.push(ScanaStudio.gui_get_value("ch_dat0"));

    if (ScanaStudio.get_device_channels_count() > 4)
    {
        if (ScanaStudio.gui_get_value("quad_DAT") == true)
        {
            sdio_ch_list.push(ScanaStudio.gui_get_value("ch_dat1"));
            sdio_ch_list.push(ScanaStudio.gui_get_value("ch_dat2"));
            sdio_ch_list.push(ScanaStudio.gui_get_value("ch_dat3"));
        }
    }
    if (ScanaStudio.gui_get_value("CMD53_block_size") > 2048 || ScanaStudio.gui_get_value("CMD53_block_size") < 1)
    {
        return "Error, block size should be a value between 1 and 2048."
    }

    ch_list = []; //Global
    var duplicates = false;
    var i;

    for (i=0; i < sdio_ch_list.length; i++)
    {
        if (ch_list[sdio_ch_list[i]] == sdio_ch_list[i])
        {
            return "Error: One or more channels are duplicates.";
        }
        else
        {
            ch_list[sdio_ch_list[i]] = sdio_ch_list[i];
        }
        instance_name += (sdio_ch_list[i]+1).toString();
        if (i < (sdio_ch_list.length-1))
        {
            instance_name += ",";
        }
    }

    instance_name += "]";

    ScanaStudio.set_script_instance_name(instance_name);

    return ""; //All good.
}


const   CONST_t_clk_low_min            = 10e-9,
        CONST_t_clk_high_min           = 10e-9,
        CONST_t_clk_rise_min           = 1e-9,
        CONST_t_clk_fall_min           = 1e-9,
        CONST_t_clk_rise_max           = 10e-9,
        CONST_t_clk_fall_max           = 10e-9,
        CONST_t_inp_setup_min          = 5e-9,
        CONST_t_inp_hold_min           = 5e-9,
        CONST_t_output_data_delay_max  = 14e-9,
        CONST_t_output_id_delay_max    = 50e-9;

//decoder state
const   ENUM_STATE_CMD_START = 0,
        ENUM_STATE_DATA_START = 1,
        ENUM_STATE_CMD_INDEX = 2,
        ENUM_STATE_CMD_ARGUMENT = 3,
        ENUM_STATE_RSP_ARGUMENT = 4,
        ENUM_STATE_DATA = 5,
        ENUM_STATE_CRC7 = 6,
        ENUM_STATE_CRC16 = 7,
        ENUM_STATE_CMD_END = 8,
        ENUM_STATE_DATA_END = 9,
        ENUM_STATE_UNDEFINED = 10;

//SD Card Type
const   SDSC = 0,
        SDHC = 1,
        SDXC = 2,
        SDUC = 3;


function on_decode_signals(resume)
{
  if (!resume) //If resume == false, it's the first call to this function.
  {
    //initialization code goes here, ex:
    sampling_rate = ScanaStudio.get_capture_sample_rate();
    reload_dec_gui_values();
    initialize_CMD53_size_block(block_size);
    if (ddr == true)
    {
        dat_clock_polarity = -1; //Dual Edge
    }
    cmd_channel.push(ch_cmd);
    data_channels.push(ch_dat0);
    trs_clk = ScanaStudio.trs_reset(ch_clk);
    var trs_clk = ScanaStudio.trs_get_next(ch_clk);
    var tmp_trs_sample_index;
    tmp_trs_sample_index = trs_clk.sample_index;
    while( (tmp_trs_sample_index == trs_clk.sample_index) && (ScanaStudio.trs_is_not_last(ch_clk) == true) )
    {
        trs_clk = ScanaStudio.trs_get_next(ch_clk);
    }
    trs_cmd = ScanaStudio.trs_reset(ch_cmd);
    var trs_cmd = ScanaStudio.trs_get_next(ch_cmd);
    tmp_trs_sample_index = trs_cmd.sample_index;
    while( (tmp_trs_sample_index == trs_cmd.sample_index) && (ScanaStudio.trs_is_not_last(ch_cmd) == true) )
    {
        trs_cmd = ScanaStudio.trs_get_next(ch_cmd);
    }
    trs_dat0 = ScanaStudio.trs_reset(ch_dat0);
    trs_dat0 = ScanaStudio.trs_get_next(ch_dat0);
    tmp_trs_sample_index = trs_dat0.sample_index;
    while( (tmp_trs_sample_index == trs_dat0.sample_index) && (ScanaStudio.trs_is_not_last(ch_dat0) == true) )
    {
        trs_dat0 = ScanaStudio.trs_get_next(ch_dat0);
    }
    trs_data.push(trs_dat0);
    if (speed_mode == 1) //There is the 4 DAT channels
    {
        data_channels = [];
        data_channels.push(ch_dat3);
        data_channels.push(ch_dat2);
        data_channels.push(ch_dat1);
        data_channels.push(ch_dat0);
        trs_dat1 = ScanaStudio.trs_reset(ch_dat1);
        var trs_dat1 = ScanaStudio.trs_get_next(ch_dat1);
        tmp_trs_sample_index = trs_dat1.sample_index;
        while( (tmp_trs_sample_index == trs_dat1.sample_index) && (ScanaStudio.trs_is_not_last(ch_dat1) == true) )
        {
            trs_dat1 = ScanaStudio.trs_get_next(ch_dat1);
        }
        trs_dat2 = ScanaStudio.trs_reset(ch_dat2);
        var trs_dat2 = ScanaStudio.trs_get_next(ch_dat2);
        tmp_trs_sample_index = trs_dat2.sample_index;
        while( (tmp_trs_sample_index == trs_dat2.sample_index) && (ScanaStudio.trs_is_not_last(ch_dat2) == true) )
        {
            trs_dat2 = ScanaStudio.trs_get_next(ch_dat2);
        }
        trs_dat3 = ScanaStudio.trs_reset(ch_dat3);
        var trs_dat3 = ScanaStudio.trs_get_next(ch_dat3);
        tmp_trs_sample_index = trs_dat3.sample_index;
        while( (tmp_trs_sample_index == trs_dat3.sample_index) && (ScanaStudio.trs_is_not_last(ch_dat3) == true) )
        {
            trs_dat3 = ScanaStudio.trs_get_next(ch_dat3);
        }
        trs_data = [];
        trs_data.push(trs_dat3);
        trs_data.push(trs_dat2);
        trs_data.push(trs_dat1);
        trs_data.push(trs_dat0);
    }
    //init global variables
    state_machine = ENUM_STATE_CMD_START;
  }//end if (!resume)
  else
  {
      //ScanaStudio.console_info_msg("Decoding resumed");
  }

  while (ScanaStudio.abort_is_requested() == false)
  {
        // ScanaStudio.console_info_msg(".");
        if ((!ScanaStudio.trs_is_not_last(ch_cmd)) && (!ScanaStudio.trs_is_not_last(ch_dat0)))
        {
            break;
        }
        switch (state_machine)
        {
            case ENUM_STATE_CMD_START: //Looking for a starting bit
            {
                if (trs_cmd.value == 0) //(falling edge)
                {
                    nbits = 2;
                    sdio_simple = sync_decode_v2(cmd_channel,trs_cmd.sample_index,nbits);
                    if (last_trans == true) //if sync_decode overpassed the last sample
                    {
                        go_to_last_trans_cmd();
                        break;
                    }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        //Dec Item
                        if (item_display[0] == 1) //Start bit = 1
                        {
                            dec_item_new_v2 (ch_cmd, sdio_simple);
                            ScanaStudio.dec_item_add_content("Start");
                            ScanaStudio.dec_item_add_content("S");
                            ScanaStudio.dec_item_add_sample_point(sdio_simple.start_sample,"P")
                            ScanaStudio.dec_item_emphasize_error();
                            state_machine = ENUM_STATE_CMD_START;
                            trs_cmd.value = -1;
                            item_display = [];
                            crc_calcul = [];
                            ScanaStudio.dec_item_end();
                            //Packet View
                            ScanaStudio.packet_view_add_packet(true,ch_cmd,sdio_simple.start_sample,sdio_simple.end_sample,"SDIO","CH_CMD",ScanaStudio.get_channel_color(ch_cmd),ScanaStudio.get_channel_color(ch_cmd));
                            break;
                        }
                        //Packet View
                        ScanaStudio.packet_view_add_packet(true,ch_cmd,sdio_simple.start_sample,sdio_simple.end_sample,"SDIO","CH_CMD",ScanaStudio.get_channel_color(ch_cmd),ScanaStudio.get_channel_color(ch_cmd));
                        if (item_display[1] == 1) //Transmission bit = 1
                        {
                            dec_item_new_v2 (ch_cmd, sdio_simple);
                            if (R_type == "Undefined")
                            {
                                ScanaStudio.dec_item_add_content("Host to Card");
                                ScanaStudio.dec_item_add_content("Host");
                                ScanaStudio.dec_item_add_content("H");
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"Start","Host to Card","Wrap");
                                T_bit = sdio_simple.unsigned_words;
                            }
                            else
                            {
                                ScanaStudio.dec_item_add_content("Error, Transmission bit should be 0");
                                ScanaStudio.dec_item_add_content("Error");
                                ScanaStudio.dec_item_emphasize_error();
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"Start","Host to Card","Error");
                                ScanaStudio.dec_item_end();
                                trs_cmd.value = -1;
                                item_display = [];
                                crc_calcul = [];
                                state_machine = ENUM_STATE_CMD_START;
                                break;
                                T_bit = 0; //To force the decoder to decode the signal as a RSP
                            }
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();

                        }
                        else
                        {
                            dec_item_new_v2 (ch_cmd, sdio_simple);
                            ScanaStudio.dec_item_add_content("Card to Host");
                            ScanaStudio.dec_item_add_content("Card");
                            ScanaStudio.dec_item_add_content("C");
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"Start","Card to Host","Wrap");
                            T_bit = sdio_simple.unsigned_words;
                        }
                        trs_cmd.value = -1;
                        item_display = [];
                        state_machine = ENUM_STATE_CMD_INDEX;
                        break;
                    }
                    else
                    {
                        trs_cmd = ScanaStudio.trs_get_next(ch_cmd);
                        break;
                    }
            }//end ENUM_STATE_CMD_START

            case ENUM_STATE_DATA_START: //Looking for a starting bit
            {
                if (speed_mode == 0)
                {
                    if (trs_dat0.value == 0 ) //(falling edge)
                    {
                        nbits = 1;
                        sdio_simple = sync_decode_v3(data_channels,trs_dat0.sample_index,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_data();
                            break;
                        }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            //Dec Item
                            var item_start_stop_array = dec_item_new_v2 (ch_dat0, sdio_simple);
                            ScanaStudio.dec_item_add_content("Start");
                            ScanaStudio.dec_item_add_content("S");
                            ScanaStudio.dec_item_add_sample_point(sdio_simple.start_sample,"P")
                            if (item_display[0] == 1) //Start bit = 1
                            {
                                ScanaStudio.dec_item_emphasize_error();
                                state_machine = ENUM_STATE_DATA_START;
                                trs_dat0.value = -1;
                                item_display = [];
                                crc_calcul = [];
                                ScanaStudio.dec_item_end();
                                break;
                            }
                            ScanaStudio.dec_item_end();
                            trs_dat0.value = -1;
                            data_transfer = false;
                            item_display = [];
                            crc_calcul = [];
                        //Packet View
                        ScanaStudio.packet_view_add_packet(false,ch_dat0,item_start_stop_array[0],item_start_stop_array[1],"Start","Data",ScanaStudio.get_channel_color(ch_dat0),ScanaStudio.get_channel_color(ch_dat0));
                        state_machine = ENUM_STATE_DATA ;
                        break;
                    }
                    else
                    {
                        trs_dat0 = ScanaStudio.trs_get_next(ch_dat0);
                        break;
                    }
                }
                else
                {
                    if (trs_dat0.value == 0 ) //(falling edge)
                    {
                        nbits = 1;
                        trs_dat0.value = -1;
                        sdio_simple = sync_decode_v3(data_channels,trs_dat0.sample_index,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_data();
                            break;
                        }
                        for (e=0; e<data_channels.length; e++)
                        {
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words[e],nbits,crc_calcul);
                            //Dec Item
                            dec_item_new_v2 (data_channels[e], sdio_simple);
                            ScanaStudio.dec_item_add_content("Start");
                            ScanaStudio.dec_item_add_content("S");
                            ScanaStudio.dec_item_add_sample_point(sdio_simple.start_sample,"P")
                            if (item_display[0] == 1) //Start bit = 1
                            {
                                ScanaStudio.dec_item_emphasize_error();
                                state_machine = ENUM_STATE_DATA_START;
                                trs_data[e].value = -1;
                                item_display = [];
                                crc_calcul = [];
                                ScanaStudio.dec_item_end();
                                break;
                            }
                            ScanaStudio.dec_item_end();
                            trs_data[e].value = -1;
                            data_transfer = false;
                            item_display = [];
                            crc_calcul = [];
                        }
                    }
                    else
                    {
                        trs_dat0 = ScanaStudio.trs_get_next(ch_dat0);
                        break;
                    }
                    //Packet View
                    state_machine = ENUM_STATE_DATA ;
                    ScanaStudio.packet_view_add_packet(false,ch_dat0,sdio_simple.start_sample,sdio_simple.start_sample,"Start","Data",ScanaStudio.get_channel_color(ch_dat0),ScanaStudio.get_channel_color(ch_dat0));
                }
            }//end ENUM_STATE_DATA_START

            case ENUM_STATE_DATA: //Looking for the data transfer
            {

                switch (Number(last_CMD))
                {
                    case 6 : //CMD 6 (SWITCH_FUNC)
                    {
                        if (last_CMD_mode == 0)
                        {
                            nbits = 512;
                            var nbytes_total = nbits/8;
                            // Maximum Current/Power Consumption
                            nbytes = 2;
                            nbytes_total = nbytes_total - nbytes;
                            sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbytes*2*4/(data_channels.length)); // 1 byte
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_data();
                                break;
                            }
                            sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbytes*2*4/(data_channels.length), crc_calcul); // Create Dec Item, samples, content and packet_view
                            var power_consumption = sdio_value * 3.6;
                            ScanaStudio.dec_item_add_content("Maximum current : " + sdio_value + "mA" + " or Maximum Power Consumption : " + power_consumption + "mW");
                            ScanaStudio.dec_item_add_content("Maximum current : " + sdio_value + "mA");
                            ScanaStudio.dec_item_add_content(sdio_value + "mA");
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_string = "Maximum current : " + sdio_value + "mA";
                            packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"Max Current",packet_string,"Data");
                            // Support Bits of Functions in Function Group 6-1
                            nbytes = 2;
                            for (t=6; t>0; t--)
                            {
                                nbytes_total = nbytes_total - nbytes;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbytes*2*4/(data_channels.length)); // nbytes
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbytes*2*4/(data_channels.length), crc_calcul); // Create Dec Item and samples, return nbytes value
                                string_content = CMD6_function_supported(sdio_value)
                                ScanaStudio.dec_item_add_content(string_content + " of Function Group " + t + " are supported");
                                ScanaStudio.dec_item_add_content(string_content + " of Function Group " + t);
                                ScanaStudio.dec_item_add_content(string_content);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_title = "Group " + t + " supported";
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,packet_title,string_content,"Data");
                            }
                            // Function Selection of Function Group 6-1
                            nbytes = 0.5;
                            for (t=6; t>0; t--)
                            {
                                nbytes_total = nbytes_total - nbytes;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbytes*2*4/(data_channels.length)); // nbytes
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbytes*2*4/(data_channels.length), crc_calcul); // Create Dec Item and samples, return nbytes value
                                if (CMD6_mode == 0)
                                {
                                    packet_string = "You can switch to Function " + sdio_value;
                                    ScanaStudio.dec_item_add_content("You can switch to Function " + sdio_value + " of Group " + t);
                                    ScanaStudio.dec_item_add_content("You can switch to Function " + sdio_value);
                                }
                                else
                                {
                                    packet_string = "Switched to function " + sdio_value;
                                    ScanaStudio.dec_item_add_content("Switched to function " + sdio_value + " of Group " + t);
                                    ScanaStudio.dec_item_add_content("Switched to function " + sdio_value);
                                }
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_title = "Group " + t + " selected";
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,packet_title,packet_string,"Data");
                            }
                            // Data Structure Version
                            nbytes = 1;
                            nbytes_total = nbytes_total - nbytes;
                            sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbytes*2*4/(data_channels.length)); // 1 byte
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_data();
                                break;
                            }
                            sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbytes*2*4/(data_channels.length), crc_calcul); // Create Dec Item, samples, content and packet_view
                            if (sdio_value == 0)
                            {
                                packet_string = "Only Bits 511:376 are defined";
                                types = "Data";
                                ScanaStudio.dec_item_add_content("Only Bits 511:376 are defined, others are reserved");
                                ScanaStudio.dec_item_add_content("Only Bits 511:376 are defined");
                            }
                            else if (sdio_value == 1)
                            {
                                packet_string = "Bits 511:272 are defined";
                                types = "Data";
                                ScanaStudio.dec_item_add_content("Bits 511:376 are defined");
                            }
                            else
                            {
                                packet_string = "Reserved";
                                types = "Error";
                                ScanaStudio.dec_item_add_content("Data Structure : Reserved value");
                            }
                            ScanaStudio.dec_item_end();
                            packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"Data Structure",packet_string,types);
                            // if sdio_value egal 1 the busy status bit are defined
                            if (sdio_value == 1)
                            {
                                // Reserved for Busy Status of function in group 6-1
                                nbytes = 2;
                                for (t=6; t>0; t--)
                                {
                                    nbytes_total = nbytes_total - nbytes;
                                    sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbytes*2*4/(data_channels.length)); // nbytes
                                    if (last_trans == true) //if sync_decode overpassed the last sample
                                    {
                                        go_to_last_trans_data();
                                        break;
                                    }
                                    sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbytes*2*4/(data_channels.length), crc_calcul); // Create Dec Item and samples, return nbytes value
                                    string_content = CMD6_function_supported(sdio_value);
                                    ScanaStudio.dec_item_add_content(string_content + "of Function Group " + t + " are ready");
                                    ScanaStudio.dec_item_add_content(string_content + " are ready");
                                    ScanaStudio.dec_item_end();
                                    //Packet View
                                    packet_title = "Busy bits of Group " + t;
                                    packet_view_add_wide_width_packet(ch_dat0,sdio_simple,packet_title,packet_string,"Data");
                                }
                            }
                            nbytes = 1;
                            for (d=0; d<nbytes_total; d++)
                            {
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,8/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, 8/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                if (sdio_value == 0)
                                {
                                  packet_string = "Reserved bits";
                                  types = "Misc";
                                  ScanaStudio.dec_item_add_content("Reserved bits");
                                }
                                else
                                {
                                  packet_string = "Reserved bits should be 0";
                                  types = "Error";
                                  ScanaStudio.dec_item_add_content("Reserved bits should be 0");
                                }
                              ScanaStudio.dec_item_end();
                              //Packet view
                              packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"Reserved bit",packet_string,types);
                            }
                            trs_dat0.value = -1;
                        }
                        usual_data = false;
                        data_transfer = false;
                        break;

                    }
                    case 13 : //ACMD 13 (SD_STATUS)
                    {
                        if (last_CMD_mode == 1)
                        {
                            nbits = 512; // SD Status
                            nbytes_total = nbits/8;
                            if (speed_mode == 1)
                            {
                                for (d=0; d<nbytes_total; d++)
                                {
                                    sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,8/(data_channels.length)); // 1 byte
                                    if (last_trans == true) //if sync_decode overpassed the last sample
                                    {
                                        go_to_last_trans_data();
                                        break;
                                    }
                                    sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, 8/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                    ScanaStudio.dec_item_add_content("SD Status");
                                    ScanaStudio.dec_item_end();
                                    //Packet View
                                    packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"SD Status","","Data");
                                }
                            }
                            else
                            {
                                // DAT_BUS_WIDTH
                                nbits = 2;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                if (sdio_value == 0)
                                {
                                    packet_string = "1 DAT bus";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                else if (sdio_value == 2)
                                {
                                    packet_string = "4 DAT bus";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                else
                                {
                                    packet_string = "reserved";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"DAT_BUS_WIDTH",packet_string,types);
                                // SECURED_MODE
                                nbits = 1;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                if (sdio_value == 0)
                                {
                                    packet_string = "Not in the mode";
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                else
                                {
                                    packet_string = "In Secured Mode";
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"SECURED_MODE",packet_string,"Data");
                                // Reserved bits
                                nbits = 13;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                if (sdio_value == 0)
                                {
                                    packet_string = "Reserved bits";
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                else
                                {
                                    packet_string = "Reserved bits should be 0";
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"Reserved bit",packet_string,"Misc");
                                // SD_CARD_TYPE
                                nbits = 16;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                if (sdio_value == 0)
                                {
                                    packet_string = "Regular SD RD/WR Card";
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                else if (sdio_value == 1)
                                {
                                    packet_string = "SD ROM Card";
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                else if (sdio_value == 2)
                                {
                                    packet_string = "OTP";
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                else
                                {
                                    packet_string = "Reserved bit";
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"SD_CARD_TYPE",packet_string,"Data");
                                // SIZE_OF_PROTECTED_AREA
                                nbits = 32;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                ScanaStudio.dec_item_add_content("SIZE_OF_PROTECTED_AREA : " + sdio_value + " or 0b" + pad(sdio_value.toString(16),nbits/4));
                                ScanaStudio.dec_item_add_content("SIZE_OF_PROTECTED_AREA : " + sdio_value);
                                ScanaStudio.dec_item_add_content(sdio_value);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = sdio_value + " or 0b" + pad(sdio_value.toString(16),nbits/4);
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"SIZE_OF_PROTECTED_AREA",packet_string,"Data");
                                // SPEED_CLASS
                                nbits = 8;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                string_content = CMD13_speed_class(sdio_value);
                                ScanaStudio.dec_item_add_content("SPEED_CLASS : " + string_content);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"SPEED_CLASS",string_content,"Data");
                                // PERFORMANCE_MOVE
                                nbits = 8;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                if (sdio_value == 0)
                                {
                                    packet_string = "Sequential Write";
                                    ScanaStudio.dec_item_add_content("PERFORMANCE_MOVE : Sequential Write");
                                }
                                else if (sdio_value == 255)
                                {
                                    packet_string = "Infinity";
                                    ScanaStudio.dec_item_add_content("PERFORMANCE_MOVE : Infinity");
                                }
                                else
                                {
                                    packet_string = sdio_value + "MB/sec";
                                    ScanaStudio.dec_item_add_content("PERFORMANCE_MOVE : " + packet_string);
                                }
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"SPEED_CLASS",packet_string,"Data");
                                // AU_SIZE
                                nbits = 4;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                packet_string = AU_SIZE(sdio_value);
                                ScanaStudio.dec_item_add_content("AU_SIZE : " + packet_string);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"AU_SIZE",packet_string,"Data");
                                // Reserved bits
                                nbits = 4;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                if (sdio_value == 0)
                                {
                                    packet_string = "Reserved bits";
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                else
                                {
                                    packet_string = "Reserved bits should be 0";
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"Reserved bit",packet_string,"Misc");
                                // ERASE_SIZE
                                nbits = 16;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                if (sdio_value == 0)
                                {
                                    packet_string = "Erase Time-out Calculation not supported";
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                else
                                {
                                    packet_string = sdio_value + " AU";
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"ERASE_SIZE",packet_string,"Data");
                                // ERASE_TIMEOUT
                                nbits = 6;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                if (sdio_value == 0)
                                {
                                    packet_string = "Erase Time-out Calculation not supported";
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                else
                                {
                                    packet_string = sdio_value + "s";
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"ERASE_TIMEOUT",packet_string,"Data");
                                // ERASE_OFFSET
                                nbits = 2;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                packet_string = sdio_value + "s";
                                ScanaStudio.dec_item_add_content(packet_string);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"ERASE_OFFSET",packet_string,"Data");
                                // UHS_SPEED_GRADE
                                nbits = 4;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                item_content = UHS_SPEED_GRADE(sdio_value);
                                ScanaStudio.dec_item_add_content("UHS_SPEED_GRADE : " + item_content);
                                ScanaStudio.dec_item_add_content(item_content);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"UHS_SPEED_GRADE",item_content,"Data");
                                // UHS_AU_SIZE
                                nbits = 4;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                if (sdio_value == 0)
                                {
                                    packet_string = "Not Defined";
                                    ScanaStudio.dec_item_add_content("UHS_AU_SIZE : " + packet_string);
                                }
                                else if (sdio_value < 7)
                                {
                                    packet_string = "Not Used";
                                    ScanaStudio.dec_item_add_content("UHS_AU_SIZE : " + packet_string);
                                }
                                else
                                {
                                    var au_size = (sdio_value - 6)* Math.pow(2,sdio_value - 7);
                                    packet_string = au_size + "MB";
                                    ScanaStudio.dec_item_add_content("UHS_AU_SIZE : " + packet_string);
                                }
                                ScanaStudio.dec_item_add_content(item_content);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"UHS_AU_SIZE",item_content,"Data");
                                // VIDEO_SPEED_CLASS
                                nbits = 8;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                if (sdio_value == 6 || sdio_value == 10 || sdio_value == 30 || sdio_value == 60 || sdio_value == 90)
                                {
                                    packet_string = sdio_value;
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("VIDEO_SPEED_CLASS : " + sdio_value);
                                }
                                else if (sdio_value == 0)
                                {
                                    packet_string = "Not Supported";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("VIDEO_SPEED_CLASS : Not Supported");
                                }
                                else
                                {
                                    packet_string = "Reserved";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("VIDEO_SPEED_CLASS : Reserved");
                                }
                                ScanaStudio.dec_item_add_content(item_content);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"VIDEO_SPEED_CLASS",item_content,types);
                                // Reserved bits
                                nbits = 6;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                if (sdio_value == 0)
                                {
                                    packet_string = "Reserved bits";
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                else
                                {
                                    packet_string = "Reserved bits should be 0";
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"Reserved bit",packet_string,"Misc");
                                // VSC_AU_SIZE
                                nbits = 10;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                var AU_SIZE_and_SU_SIZE = VSC_AU_SIZE(sdio_value);
                                if (sdio_value == 0)
                                {
                                    packet_string = "Video Speed Class not supported";
                                    ScanaStudio.dec_item_add_content("VSC_AU_SIZE : " + packet_string);
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                else if (AU_SIZE_and_SU_SIZE[0] != "Error")
                                {
                                    packet_string = "AU_SIZE : " + AU_SIZE_and_SU_SIZE[0] + "MB, SU_SIZE : " + AU_SIZE_and_SU_SIZE[1] + "MB";
                                    ScanaStudio.dec_item_add_content("VSC_AU_SIZE : " + packet_string);
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                else
                                {
                                    packet_string = "Incorrect Value";
                                    ScanaStudio.dec_item_add_content("VSC_AU_SIZE : " + packet_string);
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"VSC_AU_SIZE",item_content,types);
                                // SUS_ADDR
                                nbits = 22;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                if (sdio_value == 0)
                                {
                                    packet_string = "No valid suspension adress";
                                    ScanaStudio.dec_item_add_content("SUS_ADDR : " + packet_string);
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                else
                                {
                                    packet_string = "0h" + pad(sdio_value.toString(16),nbits/4);
                                    ScanaStudio.dec_item_add_content("SUS_ADDR : 0h" + packet_string);
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"SUS_ADDR",packet_string,"Data");
                                // Reserved bits
                                nbits = 6;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                if (sdio_value == 0)
                                {
                                    packet_string = "Reserved bits";
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                else
                                {
                                    packet_string = "Reserved bits should be 0";
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"Reserved bit",packet_string,"Misc");
                                // APP_PREF_CLASS
                                nbits = 4;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                if (sdio_value == 0)
                                {
                                    packet_string = "No valid suspension adress";
                                    ScanaStudio.dec_item_add_content("SUS_ADDR : " + packet_string);
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                else
                                {
                                    packet_string = "0h" + pad(sdio_value.toString(16),nbits/4);
                                    ScanaStudio.dec_item_add_content("SUS_ADDR : 0h" + packet_string);
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"SUS_ADDR",packet_string,"Data");
                                // PERFORMANCE_ENHANCE
                                nbits = 8;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                item_content = PERFORMANCE_ENHANCE(sdio_value);
                                ScanaStudio.dec_item_add_content("PERFORMANCE_ENHANCE : " + item_content);
                                ScanaStudio.dec_item_add_content(item_content);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"PERFORMANCE_ENHANCE","Look Item","Data");
                                // Reserved bits
                                nbits = 14;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                if (sdio_value == 0)
                                {
                                    packet_string = "Reserved bits";
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                else
                                {
                                    packet_string = "Reserved bits should be 0";
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"Reserved bit",packet_string,"Misc");
                                // DISCARD_SUPPORT
                                nbits = 1;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                if (sdio_value == 0)
                                {
                                    packet_string = "Not Supported";
                                    ScanaStudio.dec_item_add_content("DISCARD_SUPPORT : " + packet_string);
                                }
                                else
                                {
                                    packet_string = "Supported";
                                    ScanaStudio.dec_item_add_content("DISCARD_SUPPORT : " + packet_string);
                                }
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"DISCARD_SUPPORT",packet_string,"Data");
                                // FULE_SUPPORT
                                nbits = 1;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                if (sdio_value == 0)
                                {
                                    packet_string = "Not Supported";
                                    ScanaStudio.dec_item_add_content("FULE_SUPPORT : " + packet_string);
                                }
                                else
                                {
                                    packet_string = "Supported";
                                    ScanaStudio.dec_item_add_content("FULE_SUPPORT : " + packet_string);
                                }
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"FULE_SUPPORT",packet_string,"Data");
                                // Reserved bits
                                nbits = 8;
                                for (d=0; d<39; d++)
                                {
                                    sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                    if (last_trans == true) //if sync_decode overpassed the last sample
                                    {
                                        go_to_last_trans_data();
                                        break;
                                    }
                                    sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                    if (sdio_value == 0)
                                    {
                                        packet_string = "Reserved bits";
                                        ScanaStudio.dec_item_add_content(packet_string);
                                    }
                                    else
                                    {
                                        packet_string = "Reserved bits should be 0";
                                        ScanaStudio.dec_item_add_content(packet_string);
                                    }
                                    ScanaStudio.dec_item_end();
                                    //Packet View
                                    packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"Reserved bit",packet_string,"Misc");
                                    trs_dat0.value = -1;
                                }
                            }
                            usual_data = false;
                            break;
                        }
                    }
                    case 17 : //CMD 17 (READ_SINGLE_BLOCK)
                    {
                        nbits = Block_length*8;
                        nbytes_total = nbits/8;
                        usual_data = true;
                        break;
                    }
                    case 18 : //CMD 18 (READ_MULTIPLE_BLOCK)
                    {
                        nbits = Block_length*8; // We'll prob moove the block count because there is an inter data timing equal to Nac clock cycles
                        nbytes_total = nbits/8;
                        usual_data = true;
                        break;
                    }
                    case 19 : //CMD19 (SEND_TUNING_BLOCK)
                    {
                        nbits = 512;
                        nbytes_total = nbits/8;
                        if (speed_mode == 1)
                        {
                            for (d=0; d<nbytes_total/16; d++)
                            {
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,8*16/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                add_CMD19_data(data_channels, sdio_simple, 8*16/(data_channels.length), crc_calcul); // Create Dec Item, samples, content
                            }
                        }
                        else
                        {
                            sdio_simple = sync_decode_v2(data_channels,sdio_simple.end_sample+1,512/(data_channels.length));
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            for (u=0; u<512; u++)
                            {
                                crc_calcul.push(sdio_simple.unsigned_words[u]);
                            }
                            dec_item_new_v2(ch_dat0, sdio_simple);
                            display_sample_0_1(sdio_simple, crc_calcul); //crc is equivalent to item_display in this case
                            ScanaStudio.dec_item_end();
                        }
                        usual_data = false;
                        break;
                    }
                    case 22 : //ACMD 22 (SEND_NUM_WR_BLOCKS)
                    {
                        if (last_CMD_mode == 1)
                        {
                            nbits = 32;
                            nbytes_total = nbits/8;
                            sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 4 byte
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_data();
                                break;
                            }
                            sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, content
                            ScanaStudio.dec_item_end();
                            // Packet view
                            packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"NUM_WR_BLOCKS",sdio_value,"Data");
                        }
                        usual_data = false;
                        break;
                    }
                    case 24 : //CMD 24 (WRITE_BLOCK)
                    {
                        nbits = Block_length*8;
                        nbytes_total = nbits/8;
                        usual_data = true;
                        break;
                    }
                    case 25 : //CMD 25 (WRITE_MULTIPLE_BLOCK)
                    {
                        nbits = Block_length*8;
                        nbytes_total = nbits/8;
                        usual_data = true;
                        break;
                    }
                    case 27 : //CMD 27 (PROGRAM_CSD)
                    {
                        nbits = 128;
                        nbytes_total = nbits/8;
                        for (d=0; d<nbytes_total; d++)
                        {
                            sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,8/(data_channels.length)); // 1 byte
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_data();
                                break;
                            }
                            sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, 8/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                            ScanaStudio.dec_item_add_content("CSD Register");
                            ScanaStudio.dec_item_end();
                            // Packet view
                            packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"CSD Register","","Data");
                        }
                        usual_data = false;
                        break;
                    }
                    case 30 : //CMD 30 (SEND_WRITE_PROT)
                    {
                        nbits = 32;
                        nbytes_total = nbits/8;
                        sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_data();
                            break;
                        }
                        sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                        ScanaStudio.dec_item_add_content("Write Protection Bits");
                        ScanaStudio.dec_item_end();
                        // Packet view
                        packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"Write Protection Bit","","Data");
                        usual_data = false;
                        break;
                    }
                    case 40 : //CMD 40
                    {
                        nbits = 512*8;
                        nbytes_total = nbits/8;
                        usual_data = true;
                        break;
                    }
                    case 42 : //CMD 42 (LOCK_UNLOCK)
                    {
                        nbits = Lock_unlock_Block_length*8;
                        nbytes_total = nbits/8;
                        usual_data = true;
                        break;
                    }
                    case 51 : //ACMD51 (SEND_SCR)
                    {
                        if (last_CMD_mode == 1)
                        {
                            nbits = 64;
                            nbytes_total = nbits/8;
                            if (speed_mode == 1)
                            {
                                for (d=0; d<nbytes_total; d++)
                                {
                                    sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,8/(data_channels.length)); // 1 byte
                                    if (last_trans == true) //if sync_decode overpassed the last sample
                                    {
                                        go_to_last_trans_data();
                                        break;
                                    }
                                    sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, 8/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                    ScanaStudio.dec_item_add_content("SCR Register");
                                    ScanaStudio.dec_item_end();
                                    //Packet View
                                    packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"SCR Register","","Data");
                                }
                            }
                            else
                            {
                                // SCR_STRUCTURE
                                nbits = 4;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                if (sdio_value == 0)
                                {
                                    packet_string = "Version 1.0";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("SCR_STRUCTURE : " + packet_string);
                                    ScanaStudio.dec_item_add_content(packet_string);
                                    ScanaStudio.dec_item_add_content("1.0");
                                }
                                else
                                {
                                    packet_string = "Reserved";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("SCR_STRUCTURE : " + packet_string);
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"SCR_STRUCTURE",packet_string,types);
                                // SD_SPEC
                                nbits = 4;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                SD_SPEC = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                if (SD_SPEC < 3)
                                {
                                    packet_string = SD_SPEC;
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("SD_SPEC : " + packet_string);
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                else
                                {
                                    packet_string = "Reserved";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("SD_SPEC : " + packet_string);
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"SD_SPEC",packet_string,types);
                                // DATA_STAT_AFTER_ERASE
                                nbits = 1;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                ScanaStudio.dec_item_add_content("DATA_STAT_AFTER_ERASE : " + packet_string);
                                ScanaStudio.dec_item_add_content(packet_string);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"DATA_STAT_AFTER_ERASE",sdio_value,"Misc");
                                // SD_SECURITY
                                nbits = 3;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                if (sdio_value == 0)
                                {
                                    packet_string = "No Security";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("SD_SECURITY : " + packet_string);
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                else if (sdio_value == 1)
                                {
                                    packet_string = "Not Used";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("SD_SECURITY : " + packet_string);
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                else if (sdio_value == 2)
                                {
                                    packet_string = "SDSC Card (Security 1.01)";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("SD_SECURITY : " + packet_string);
                                    ScanaStudio.dec_item_add_content(packet_string);
                                    SD_CARD_TYPE = SDSC;
                                }
                                else if (sdio_value == 3)
                                {
                                    packet_string = "SDHC Card (Security 2.00)";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("SD_SECURITY : " + packet_string);
                                    ScanaStudio.dec_item_add_content(packet_string);
                                    SD_CARD_TYPE = SDHC;
                                }
                                else if (sdio_value == 4)
                                {
                                    packet_string = "SDXC Card (Security 3.xx)";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("SD_SECURITY : " + packet_string);
                                    ScanaStudio.dec_item_add_content(packet_string);
                                    SD_CARD_TYPE = SDXC;
                                }
                                else
                                {
                                    packet_string = "Reserved";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("SD_SECURITY : " + packet_string);
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"SD_SECURITY",packet_string,types);
                                // SD_BUS_WIDTHS
                                nbits = 4;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                item_display = dec2bin(sdio_value, nbits);
                                if (item_display[0] == 1)
                                {
                                    packet_string = "DAT0";
                                    types = "Data";
                                    item_content = "DAT0";
                                }
                                else if (item_display[2] == 1)
                                {
                                    packet_string = " and DAT0-3";
                                    types = "Data";
                                    item_content += " and DAT0-3";
                                }
                                else
                                {
                                    types = "Error";
                                }
                                ScanaStudio.dec_item_add_content("SD_BUS_WIDTHS : " + sdio_value + " supported");
                                ScanaStudio.dec_item_add_content("SD_BUS_WIDTHS : " + sdio_value);
                                ScanaStudio.dec_item_add_content(sdio_value);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = sdio_value + " or 0b" + pad(sdio_value.toString(16),nbits/4);
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"SD_BUS_WIDTHS",packet_string,types);
                                // SD_SPEC3
                                nbits = 1;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                SD_SPEC3 = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                ScanaStudio.dec_item_add_content("SD_SPEC3 : " + SD_SPEC3);
                                ScanaStudio.dec_item_add_content(SD_SPEC3);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"SD_SPEC3",SD_SPEC3,"Data");
                                // EX_SECURITY
                                nbits = 4;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                if (sdio_value == 0)
                                {
                                    packet_string = "Extended Security isn't supported";
                                    ScanaStudio.dec_item_add_content("EX_SECURITY : " + packet_string);
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                else
                                {
                                    packet_string = "Extended Security is supported";
                                    ScanaStudio.dec_item_add_content("EX_SECURITY : " + packet_string);
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"EX_SECURITY",packet_string,"Data");
                                // SD_SPEC4
                                nbits = 1;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                SD_SPEC4 = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                ScanaStudio.dec_item_add_content("SD_SPEC4 : " + SD_SPEC4);
                                ScanaStudio.dec_item_add_content(SD_SPEC4);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"SD_SPEC4",packet_string,"Data");
                                // SD_SPECX
                                nbits = 4;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                SD_SPECX = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                Physical_Specification_Version(SD_SPEC, SD_SPEC3, SD_SPEC4, SD_SPECX); // Add Item_content and packet_view
                                ScanaStudio.dec_item_end();
                                // Reserved bits
                                nbits = 2;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                if (sdio_value == 0)
                                {
                                    packet_string = "Reserved bits";
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                else
                                {
                                    packet_string = "Reserved bits should be 0";
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"Reserved bit",packet_string,"Misc");
                                // CMD_SUPPORT
                                nbits = 4;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                item_content = CMD_SUPPORT(sdio_value);
                                ScanaStudio.dec_item_add_content("CMD_SUPPORT : " + item_content + " are supported");
                                ScanaStudio.dec_item_add_content(item_content + " are supported");
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"CMD_SUPPORT",item_content,"Data");
                                // Reserved bits
                                nbits = 32;
                                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,nbits/(data_channels.length)); // 1 byte
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_data();
                                    break;
                                }
                                sdio_value = add_sdio_wide_width_data_item(data_channels, sdio_simple, nbits/(data_channels.length), crc_calcul); // Create Dec Item, samples, return nbytes value
                                if (sdio_value == 0)
                                {
                                    packet_string = "Reserved bits";
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                else
                                {
                                    packet_string = "Reserved bits should be 0";
                                    ScanaStudio.dec_item_add_content(packet_string);
                                }
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"Reserved bit",packet_string,"Misc");
                            }
                        }
                        usual_data = false;
                        break;
                    }//end ACMD51
                    case 53 : //CMD 53 (IO_RW_EXTENDED)
                    {
                        if (Block_mode == 1) // Transfer block of data
                        {
                            switch (function_number)
                            {
                                case 0 :
                                {
                                    Block_length = Function_0_block_size;
                                    break;
                                }
                                case 1 :
                                {
                                    Block_length = Function_1_block_size;
                                    break;
                                }
                                case 2 :
                                {
                                    Block_length = Function_2_block_size;
                                    break;
                                }
                                case 3 :
                                {
                                    Block_length = Function_3_block_size;
                                    break;
                                }
                                case 4 :
                                {
                                    Block_length = Function_4_block_size;
                                    break;
                                }
                                case 5 :
                                {
                                    Block_length = Function_5_block_size;
                                    break;
                                }
                                case 6 :
                                {
                                    Block_length = Function_6_block_size;
                                    break;
                                }
                                case 7 :
                                {
                                    Block_length = Function_7_block_size;
                                    break;
                                }
                            }
                        }
                        else
                        {
                            Block_length = Block_count; // When block_mode == 0, block_count is egal to bytes count
                            Block_count = 1;
                        }
                        nbits = Block_length*8;
                        nbytes_total = nbits/8;
                        usual_data = true;
                        break;
                    }
                    case 56 : //CMD 56 (GEN_CMD)
                    {
                        nbits = Block_length*8;
                        nbytes_total = nbits/8;
                        usual_data = true;
                        break;
                    }
                    case 58 : //CMD 58 (READ_EXTR_MULT)
                    {
                        nbits = Block_length*8;
                        nbytes_total = nbits/8;
                        usual_data = true;
                        break;
                    }
                    case 59 : //CMD 59 (WRITE_EXTR_MULTI)
                    {
                        nbits = Block_length*8;
                        nbytes_total = nbits/8;
                        usual_data = true;
                        break;
                    }
                    default : // CMD48/49 (READ/WRITE_EXTR_SINGLE)
                    {
                        nbits = 512*8;
                        nbytes_total = nbits/8;
                        usual_data = true;
                        break;
                    }
                }
                if (usual_data == true)
                {
                    error = 0;
                    start_usual_data_sample = sdio_simple.end_sample;
                    for (d=0; d<nbytes_total; d++)
                    {
                        sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,8/(data_channels.length)); // 1 byte
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_data();
                            break;
                        }
                        if (sdio_simple.sampling_points[1] - sdio_simple.sampling_points[0] < 20)
                        {
                            sampling_rate_too_low = true;
                        }
                        sdio_value = add_sdio_usual_data_item(data_channels, sdio_simple, 8/(data_channels.length), crc_calcul); // Create Dec Item, samples, content and packet_view
                        trs_dat0.value = -1;
                        // Stop the transfer instantly after we overpassed the end bit of CMD 12
                        if ((end_data_sample_index < sdio_simple.end_sample) && (last_CMD == 18 || last_CMD == 25))
                        {
                            STOP_TRANSMISSION = true;
                            end_data_sample_index = ScanaStudio.get_available_samples(ch_clk);
                            break;
                        }
                    }
                }
                data_transfer = false;
                if (last_trans == true) //if sync_decode overpassed the last sample
                {
                    state_machine = ENUM_STATE_CMD_START;
                    break;
                }
                if (sampling_rate_too_low == true)
                {
                    ScanaStudio.dec_item_new(ch_clk,start_usual_data_sample,sdio_simple.end_sample);
                    ScanaStudio.dec_item_add_content("The sampling rate is too low to decode the signal");
                    ScanaStudio.dec_item_emphasize_warning();
                    ScanaStudio.dec_item_end();
                }
                // Stop the transfer instantly after we overpassed the end bit of CMD 12
                if (STOP_TRANSMISSION == true) // CMD 12 detected
                {
                    state_machine = ENUM_STATE_CMD_START;
                    sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample+1,32);
                    dec_item_new_v2(ch_dat0,sdio_simple);
                    ScanaStudio.dec_item_add_content("STOP CMD DETECTED, STOP TRANSMISSION");
                    ScanaStudio.dec_item_end();
                    ScanaStudio.packet_view_add_packet(false,ch_dat0,sdio_simple.start_sample,sdio_simple.end_sample,"STOP TRANSMISSION","CMD 12 DETECTED",ScanaStudio.PacketColors.Wrap.Title,ScanaStudio.PacketColors.Wrap.Content);
                    end_data_sample_index = ScanaStudio.get_available_samples(ch_clk);
                    STOP_TRANSMISSION = false;
                    break;
                }
                state_machine = ENUM_STATE_CRC16 ;
                break;
            }//end ENUM_STATE_DATA

            case ENUM_STATE_CMD_INDEX: //Looking for the command index
            {
                nbits = 6;
                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                if (last_trans == true) //if sync_decode overpassed the last sample
                {
                    go_to_last_trans_cmd();
                    state_machine = ENUM_STATE_DATA_START;
                    break;
                }
                if (last_trans == true) //if sync_decode overpassed the last sample
                {
                    go_to_last_trans_cmd();
                    state_machine = ENUM_STATE_DATA_START;
                    break;
                }
                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                //Dec Item
                dec_item_new_v2(ch_cmd,sdio_simple);
                CMD = sdio_simple.unsigned_words;
                if (T_bit == 1) // Host
                {
                    state_machine = ENUM_STATE_CMD_ARGUMENT;
                    if (CMD_mode == 0)
                    {
                        packet_string = "CMD"+CMD;
                        types = "Preamble";
                        ScanaStudio.dec_item_add_content("CMD" + CMD);
                    }
                    else
                    {
                        packet_string = "ACMD" + CMD;
                        types = "Preamble";
                        ScanaStudio.dec_item_add_content("ACMD" + CMD);
                    }
                }
                else // Card
                {
                    state_machine = ENUM_STATE_RSP_ARGUMENT;
                    switch(R_type)
                    {
                        case "R1" :
                        {
                            if (last_CMD_mode == 1)
                            {
                                packet_string = "R1 to ACMD" + CMD;
                                types = "Preamble";
                                ScanaStudio.dec_item_add_content("R1 to ACMD" + CMD);
                                ScanaStudio.dec_item_add_content("R1");
                                // last_CMD_mode = 0;
                                break;
                            }
                            else
                            {
                                packet_string = "R1 to CMD" + last_CMD;
                                types = "Preamble";
                                ScanaStudio.dec_item_add_content("R1 to CMD" + CMD);
                                ScanaStudio.dec_item_add_content("R1");
                                break;
                            }
                        }
                        case "R1b" :
                        {
                            packet_string = "R1b to CMD" + last_CMD;
                            types = "Preamble";
                            ScanaStudio.dec_item_add_content("R1b to CMD" + CMD);
                            ScanaStudio.dec_item_add_content("R1b");
                            break;
                        }
                        case "R5" :
                        {
                            if (Number(sdio_simple.unsigned_words) == 53 || Number(sdio_simple.unsigned_words) == 52)
                            {
                                packet_string = "R5 to CMD" + last_CMD;
                                types = "Preamble";
                                ScanaStudio.dec_item_add_content("R5 to CMD" + CMD);
                                ScanaStudio.dec_item_add_content("R5");
                            }
                            else
                            {
                                types = "Error";
                                packet_string = "Should be a R5 to CMD52 or CMD53";
                                ScanaStudio.dec_item_add_content("Should be a R5 to CMD52 or CMD53");
                                ScanaStudio.dec_item_emphasize_error();
                            }

                            break;
                        }
                        case "R6" :
                        {
                            packet_string = "R6 to CMD" + CMD;
                            types = "Preamble";
                            ScanaStudio.dec_item_add_content("R6 to CMD" + CMD);
                            ScanaStudio.dec_item_add_content("R6");
                            break;
                        }
                        case "R2" :
                        case "R3" :
                        case "R4" :
                        {
                            if (Number(sdio_simple.unsigned_words) == 63)
                            {
                                packet_string = R_type + " to CMD" + last_CMD;
                                types = "Preamble";
                                ScanaStudio.dec_item_add_content("Reserved bits (111111)");
                                ScanaStudio.dec_item_add_content("Reserved bits");
                            }
                            else
                            {
                                types = "Error";
                                packet_string = "Should be (111111)";
                                ScanaStudio.dec_item_add_content("Should be (111111)");
                                ScanaStudio.dec_item_emphasize_warning();
                            }
                            break;
                        }
                        case "R7" :
                        {
                            if (Number(sdio_simple.unsigned_words)== 8)
                            {
                                packet_string = "R7 to CMD8";
                                types = "Preamble";
                                ScanaStudio.dec_item_add_content("R7 to CMD8");
                                ScanaStudio.dec_item_add_content("R7");
                            }
                            else
                            {
                                types = "Error";
                                packet_string = "Should be response to CMD 8 (001000)";
                                ScanaStudio.dec_item_add_content("Should be response to CMD 8 (001000)");
                                ScanaStudio.dec_item_emphasize_warning();
                            }
                            break;
                        }
                        case "Undefined" :
                        {
                            packet_string = "CMD" + last_CMD + " shouldn't have RSP";
                            types = "Error";
                            ScanaStudio.dec_item_add_content("CMD" + last_CMD + " shouldn't have RSP");
                            ScanaStudio.dec_item_add_content("Error");
                            ScanaStudio.dec_item_emphasize_error();
                            break;
                        }
                    }//end switch(R_type)
                }
                ScanaStudio.dec_item_add_content(packet_string);
                display_sample(sdio_simple);
                ScanaStudio.dec_item_end();
                //Packet View
                packet_view_add_packet_v2(ch_cmd,sdio_simple,"CMD INDEX",packet_string,types);
                break;
            }

            case ENUM_STATE_CMD_ARGUMENT : //Looking for argument corresponding to the CMD
            {
                last_CMD = CMD;
                last_CMD_mode = CMD_mode;
                switch (Number(CMD))
                {
                    case 2 :
                    case 9 :
                    case 10 :
                    {
                        if (SDIO_only == true)
                        {
                            R_type = "Undefined";
                            break;
                        }
                        R_type = "R2";
                        break;
                    }
                    case 6  :
                    case 11 :
                    case 13 :
                    case 16 :
                    case 17 :
                    case 18 :
                    case 19 :
                    case 22 :
                    case 23 :
                    case 24 :
                    case 25 :
                    case 27 :
                    case 30 :
                    case 32 :
                    case 33 :
                    case 42 :
                    case 44 :
                    case 45 :
                    case 46 :
                    case 47 :
                    case 48 :
                    case 49 :
                    case 51 :
                    case 55 :
                    case 56 :
                    case 58 :
                    case 59 :
                    {
                        if ((CMD == 13 || CMD == 16 || CMD == 17 || CMD == 18 || CMD == 24 || CMD == 25) && (SDIO_only == true))
                        {
                            R_type = "Undefined";
                            break;
                        }
                        if (CMD_mode == 1 && (CMD == 6 || CMD == 42 || CMD == 51) && SDIO_only == true)
                        {
                            R_type = "Undefined";
                            break;
                        }
                        R_type = "R1";
                        break;
                    }
                    case 7  :
                    case 12 :
                    case 20 :
                    case 28 :
                    case 29 :
                    case 38 :
                    case 43 :
                    {
                        if (CMD == 12 && SDIO_only == true)
                        {
                            R_type = "Undefined";
                            break;
                        }
                        R_type = "R1b";
                        break;
                    }
                    case 41 :
                    {
                        if (CMD_mode == 1)
                        {
                            R_type = "R3";
                            if (CMD == 12 && SDIO_only == true)
                            {
                                R_type = "Undefined";
                                break;
                            }
                        }
                        else
                        {
                            R_type = "Undefined";
                        }
                        break;
                    }
                    case 3 :
                    {
                        R_type = "R6";
                        break;
                    }
                    case 5 :
                    {
                        R_type = "R4"
                        break;
                    }
                    case 8 :
                    {
                        R_type = "R7";
                        break;
                    }
                    case 52 :
                    case 53 :
                    {
                        R_type = "R5";
                        break;
                    }
                }//end first switch (Number(CMD))

                switch(Number(CMD))
                {
                    case 6  :
                    case 17 :
                    case 18 :
                    case 19 :
                    case 24 :
                    case 25 :
                    case 27 :
                    case 30 :
                    case 40 :
                    case 46 :
                    case 47 :
                    case 48 :
                    case 49 :
                    case 53 :
                    case 56 :
                    case 58 :
                    case 59 :
                    {
                        if (Number(CMD) == 6)
                        {
                            if (last_CMD_mode == 1)
                            {
                                data_transfer = false;
                                break;
                            }
                        }
                        data_transfer = true;
                        break;
                    } //end case 6/17/18/19/24/25/27/30/40/46/47/48/49/56/58/59
                    case 13 :
                    case 22 :
                    case 51 :
                    {
                        if(last_CMD_mode == 1)
                        {
                            data_transfer = true;
                        }
                        break;
                    }
                }//end second switch (Number(CMD))

                switch (Number(CMD))
                {
                    case 0  : //CMD0 (GO_IDLE_STATE)
                    // case 1  : //CMD1
                    case 2  : //CMD2 (ALL_SEND_CID)
                    case 3  : //CMD3 (SEND_RELATIVE_ADRESS)
                    case 12 : //CMD12 (STOP_TRANSMISSION)
                    case 27 : //CMD27 (PROGRAM_CSD)
                    case 38 : //CMD38 (ERASE)
                    case 51 : //ACMD51 (SEND_SCR)
                    {
                        if (CMD == 2 && SDIO_only == true)
                        {
                            nbits = 32;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            ScanaStudio.dec_item_add_content("The CID Register doesn't exist for SDIO only Card");
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"CMD Argument","Unsupported command for SDIO card only","Error");
                            if (CMD_mode == 1)
                            {
                                CMD_mode = 0;
                            }
                            state_machine = ENUM_STATE_CRC7;
                            break;
                        }
                        if ((CMD == 12) && (SDIO_only == true))
                        {
                            nbits = 32;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            ScanaStudio.dec_item_add_content("Unsupported command for SDIO card only");
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"CMD Argument","Unsupported command for SDIO card only","Error");
                            if (CMD_mode == 1)
                            {
                                CMD_mode = 0;
                            }
                            state_machine = ENUM_STATE_CRC7;
                            break;
                        }
                        // Read Stuff bits
                        nbits = 32;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("Stuff bits (irrelevant)");
                        ScanaStudio.dec_item_add_content("no care");
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        CMD = -1;
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Reserved Bit","Stuff bits","Misc");
                        CMD_mode = 0; //Reset ACMD mode
                        state_machine = ENUM_STATE_CRC7;
                        break;
                    }//end case 0/1/2/12

                    case 4 : //CMD4 (SET_DSR)
                    {
                        if (SDIO_only == true)
                        {
                            nbits = 32;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            ScanaStudio.dec_item_add_content("The DSR Register doesn't exist for SDIO only Card");
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"CMD Argument","Unsupported command for SDIO card only","Error");
                            if (CMD_mode == 1)
                            {
                                CMD_mode = 0;
                            }
                            state_machine = ENUM_STATE_CRC7;
                            break;
                        }
                        // Read DSR
                        nbits = 16;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("DSR");
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"DSR","DSR","Data");
                        // Read Stuff bits
                        nbits = 16;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("Stuff bits");
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Stuff Bit","Stuff bits","Misc");
                        CMD = -1;
                        state_machine = ENUM_STATE_CRC7;
                        break;
                    }//end case 4

                    case 5 : //CMD5 (IO_SEND_OP_COND)
                    {
                        // Read Stuff bits
                        nbits = 7;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("Stuff bits (irrelevant)");
                        ScanaStudio.dec_item_add_content("no care");
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Stuff Bit","Stuff bits","Misc");
                        // Read S18R
                        nbits = 1;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        sdio_value = Number(sdio_simple.unsigned_words);
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (sdio_value == 1)
                        {
                            packet_string = "Switch Requested";
                            ScanaStudio.dec_item_add_content("Switching to 1.8V Request");
                        }
                        else
                        {
                            packet_string = "Switch Not Requested";
                            ScanaStudio.dec_item_add_content("Switch to 1.8V not requested");
                        }
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"S18R",packet_string,"Data");
                        // Read I/O OCR Value
                        nbits = 24;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        CMD_VDD_value = sdio_simple.unsigned_words;
                        Voltage_window_24(item_display,sdio_simple,ch_cmd); //Display item content and packet view
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        item_display = [];
                        CMD = -1;
                        state_machine = ENUM_STATE_CRC7;
                        break;
                    }//end case 5

                    case 6 : //ACMD6 et CMD6
                    {
                        if (CMD_mode == 1) // ACMD6 (SET_BUS_WIDTH) (SD Memory)
                        {
                            if (SDIO_only == true)
                            {
                                nbits = 32;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                ScanaStudio.dec_item_add_content("Unsupported command for SDIO only Card");
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"CMD Argument","Unsupported command for SDIO only Card","Error");
                                if (CMD_mode == 1)
                                {
                                    CMD_mode = 0;
                                }
                                state_machine = ENUM_STATE_CRC7;
                                break;
                            }
                            // Read Stuff bits
                            nbits = 30;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            ScanaStudio.dec_item_add_content("Stuff bits (irrelevant)");
                            ScanaStudio.dec_item_add_content("no care");
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"Stuff Bit","Stuff bits","Misc");
                            // Read bus Width
                            nbits = 2;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            if (sdio_simple.unsigned_words == 1)
                            {
                                packet_string = "1-bit Memory Data Transfer Mode";
                                types = "Data";
                                var BUS_WIDTH = 1;
                                ScanaStudio.dec_item_add_content("1-bit Data Transfer Mode");
                            }
                            else if  (sdio_simple.unsigned_words == 2)
                            {
                                packet_string = "4-bit Memory Data Transfer Mode";
                                types = "Data";
                                var BUS_WIDTH = 4;
                                ScanaStudio.dec_item_add_content("4-bit Data Transfer Mode");
                            }
                            else
                            {
                                packet_string = sdio_simple.unsigned_words + "-bit Data Transfer Mode not exist";
                                types = "Error";
                                ScanaStudio.dec_item_add_content(sdio_simple.unsigned_words + "-bit Data Transfer Mode not exist");
                            }
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"BUS_WIDTH",packet_string,types);
                            item_display = [];
                            CMD_mode = 0; //Reset ACMD mode
                        }
                        else // CMD6 (SWITCH_FUNC)
                        {
                            // Read Mode
                            nbits = 1;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            var CMD6_mode = Number(sdio_simple.unsigned_words);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            if (sdio_value == 0)
                            {
                                packet_string = "Check function";
                                ScanaStudio.dec_item_add_content("Check function");
                            }
                            else
                            {
                                packet_string = "Switch function";
                                ScanaStudio.dec_item_add_content("Switch function");
                            }
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"Mode",packet_string,"Data");
                            // Read Reserved bits
                            nbits = 7;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            sdio_value = Number(sdio_simple.unsigned_words);
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            if (sdio_value == 0)
                            {
                                packet_string = "Reserved bits";
                                types = "Misc";
                                ScanaStudio.dec_item_add_content("Reserved bits");
                            }
                            else
                            {
                                packet_string = "Reserved bits should be 0";
                                types = "Error";
                                ScanaStudio.dec_item_add_content("Reserved bits should be 0");
                                ScanaStudio.dec_item_emphasize_error();
                            }
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"Reserved Bit",packet_string,types);

                            // Read Reserved function group 6
                            nbits = 4;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            sdio_value = Number(sdio_simple.unsigned_words);
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            if (sdio_value == 0 || sdio_value == 15)
                            {
                                packet_string = "Default function group 6";
                                types = "Misc";
                                ScanaStudio.dec_item_add_content("Default function group 6");
                            }
                            else
                            {
                                packet_string = "Reserved function group 6";
                                types = "Error";
                                ScanaStudio.dec_item_add_content("Reserved function group 6");
                                ScanaStudio.dec_item_emphasize_warning();
                            }
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"Function Group 6",packet_string,types);
                            // Read Reserved function group 5
                            nbits = 4;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            sdio_value = Number(sdio_simple.unsigned_words);
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            if (sdio_value == 0 || sdio_value == 15)
                            {
                                packet_string = "Default function group 5";
                                types = "Misc";
                                ScanaStudio.dec_item_add_content("Default function group 5");
                            }
                            else
                            {
                                packet_string = "Reserved function group 5";
                                types = "Error";
                                ScanaStudio.dec_item_add_content("Reserved function group 5");
                                ScanaStudio.dec_item_emphasize_warning();
                            }
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"Function Group 5",packet_string,types);
                            // Read Reserved function group 4
                            nbits = 4;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            sdio_value = Number(sdio_simple.unsigned_words);
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            var item_content = function_group_4(sdio_value, CMD6_mode);
                            ScanaStudio.dec_item_add_content("Current limit : " + item_content);
                            ScanaStudio.dec_item_add_content(item_content);
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"Current limit",item_content,"Data");
                            // Read Reserved function group 3
                            nbits = 4;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            sdio_value = Number(sdio_simple.unsigned_words);
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            var item_content = function_group_3(sdio_value, CMD6_mode);
                            ScanaStudio.dec_item_add_content("Driver Strength : " + item_content);
                            ScanaStudio.dec_item_add_content(item_content);
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"Driver Strengh",item_content,"Data");
                            // Read Reserved function group 2
                            nbits = 4;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            sdio_value = Number(sdio_simple.unsigned_words);
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            var item_content = function_group_2(sdio_value, CMD6_mode);
                            ScanaStudio.dec_item_add_content("Command System : " + item_content);
                            ScanaStudio.dec_item_add_content(item_content);
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"Command System",item_content,"Data");
                            // Read Reserved function group 1
                            nbits = 4;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            sdio_value = Number(sdio_simple.unsigned_words);
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            var item_content = function_group_1(sdio_value, CMD6_mode);
                            ScanaStudio.dec_item_add_content("Bus Speed Mode : " + item_content + "(Function " + sdio_value + ")");
                            ScanaStudio.dec_item_add_content("Access Mode : " + item_content);
                            ScanaStudio.dec_item_add_content(item_content);
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"Bus Speed Mode",item_content,"Data");
                            // Read Argument (if Mode = 0, check if the function is supported, else switch to this function if this one is not busy or unsupported)
                        } // Faudra rajouter un truc avec genre if (last_CMD == 6 && last_CMD_mode == 0) then dans la data qu'on lit on la lit comme il faut avec les 512 bits mais du coup on les lis par pack (j'pense)
                        CMD = -1;
                        state_machine = ENUM_STATE_CRC7;
                        break;
                    }//end case 6

                    case 22 : //ACMD22 and CMD22
                    {
                        if (CMD_mode == 1) // ACMD22 (SEND_NUM_WR_BLOCKS)
                        {
                            // Read Stuff bits
                            nbits = 32;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            ScanaStudio.dec_item_add_content("Stuff bits (irrelevant)");
                            ScanaStudio.dec_item_add_content("no care");
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            CMD = -1;
                            //Packet View
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"Stuff Bit","Stuff bits","Misc");
                            CMD_mode = 0; //Reset ACMD mode
                        }
                        else //CMD22 (ADRESS_EXTENSION)
                        {
                            // Read Stuff bits
                            nbits = 26;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            reserved_bit(sdio_simple);
                            // Read Extended adress
                            nbits = 6;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            sdio_value = Number(sdio_simple.unsigned_words);
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            ScanaStudio.dec_item_add_content("Extended Adress : 0b" + pad(sdio_value.toString(2),6));
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_string = pad(sdio_value.toString(2),6);
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"Extended Adress",packet_string,"Data");
                        }
                        CMD = -1;
                        state_machine = ENUM_STATE_CRC7;
                        break;
                    }//end case 22

                    // All of these cmd are reserved for SD commands system expansion
                    case 34 : // CMD34
                    case 35 : // CMD35
                    case 36 : // CMD36
                    case 37 : // CMD37
                    case 50 : // CMD50
                    case 57 : // CMD57
                    {
                        // Read Reserved for SD command system expansion bits
                        nbits = 32;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        sdio_value = Number(sdio_simple.unsigned_words);
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("Reserved for SD command system expansion");
                        display_sample_0_1(sdio_simple, item_display);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Reserved Bit","For SD command system expansion","Data");
                        CMD = -1;
                        state_machine = ENUM_STATE_CRC7;
                        break;
                    }//end case 34-37/50/57

                    case 8 : //CMD8 (SEND_IF_COND)
                    {
                        // Read Reserved bits
                        nbits = 20;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (sdio_simple.unsigned_words == 0)
                        {
                            ScanaStudio.dec_item_add_content("Reserved bits = 0");
                            packet_string = "Reserved bits = 0";
                            types = "Misc";
                        }
                        else
                        {
                            packet_string = "Reserved bits should be 0";
                            types = "Error";
                            ScanaStudio.dec_item_add_content("Reserved bits should be 0");
                            ScanaStudio.dec_item_emphasize_warning();
                        }
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Reserved Bit",packet_string,types);
                        // Read Supply Voltage Value (VHS)
                        nbits = 4;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        CMD8_Voltage = Number(sdio_simple.unsigned_words);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("Host supply voltage information");
                        ScanaStudio.dec_item_add_content("Host supply voltage");
                        ScanaStudio.dec_item_add_content("Supply voltage");
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"VHS","Host Supply Voltage","Data");
                        // Read Check pattern
                        nbits = 8;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        CMD8_check_pattern = Number(sdio_simple.unsigned_words);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("Check Pattern");
                        ScanaStudio.dec_item_add_content("Check");
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Check Pattern","Check Pattern","Check");
                        CMD = -1;
                        state_machine = ENUM_STATE_CRC7;
                        break;
                    }//end case 8

                    case 7  : //CMD7 (SELECT/DESELECT_CARD)
                    case 9  : //CMD9 (SEND_CSD)
                    case 10 : //CMD10 (SEND_CID)
                    case 15 : //CMD15 (GO_INACTIVE_STATE)
                    case 55 : //CMD55 (APP_CMD)
                    {
                        if ((CMD == 9 || CMD == 10) && (SDIO_only == true))
                        {
                            nbits = 32;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            ScanaStudio.dec_item_add_content("The CSD Register doesn't exist for SDIO only Card");
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"CMD Argument","Unsupported command for SDIO card only","Error");
                            if (CMD_mode == 1)
                            {
                                CMD_mode = 0;
                            }
                            state_machine = ENUM_STATE_CRC7;
                            break;
                        }
                        // Read RCA
                        nbits = 16;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        sdio_value = Number(sdio_simple.unsigned_words);
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("RCA (Card Adress) : " + sdio_simple.unsigned_words + " or 0h" + pad(sdio_value.toString(16),4));
                        ScanaStudio.dec_item_add_content("RCA (Card Adress) : 0h" + pad(sdio_value.toString(16),4));
                        ScanaStudio.dec_item_add_content("RCA : 0h" + pad(sdio_value.toString(16),4));
                        ScanaStudio.dec_item_add_content("0h" + pad(sdio_value.toString(16),4));
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = sdio_simple.unsigned_words + " or 0h" + pad(sdio_value.toString(16),4);
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"RCA",packet_string,"Data");
                        // Read Stuff bits
                        nbits = 16;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("stuff bits (irrelevant)");
                        ScanaStudio.dec_item_add_content("no care");
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Stuff Bit","Stuff Bits","Misc");
                        if (CMD == 55)
                        {
                            CMD_mode = 1; //ACMD Mode
                        }
                        CMD = -1;
                        state_machine = ENUM_STATE_CRC7;
                        break;
                    }//end case 7/13/15

                    case 13 : //CMD13 (SEND_STATUS/SEND_TASK_STATUS) and ACMD13 (SD_STATUS)
                    {
                        if (CMD_mode == 0) // CMD13 (SEND_STATUS/SEND_TASK_STATUS)
                        {
                            // Read RCA
                            nbits = 16;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            ScanaStudio.dec_item_add_content("RCA (Card Adress) : " + sdio_simple.unsigned_words);
                            ScanaStudio.dec_item_add_content("RCA");
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_string = "Card Adress : " + sdio_simple.unsigned_words;
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"RCA",packet_string,"Data");
                            // Task Status Register or Status Register
                            nbits = 1;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            sdio_value = Number(sdio_simple.unsigned_words);
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            if (sdio_value == 1 && CQ_enable == true)
                            {
                                packet_string = "Send Task Status Register";
                                send_CQ = true;
                            }
                            else
                            {
                                packet_string = "Send Status Register";
                            }
                            ScanaStudio.dec_item_add_content(packet_string);
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"TSR/SR",packet_string,"Data");
                            // Read Stuff bits
                            nbits = 15;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            ScanaStudio.dec_item_add_content("stuff bits (irrelevant)");
                            ScanaStudio.dec_item_add_content("no care");
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"Stuff Bit","Stuff Bits","Misc");
                        }
                        else // ACMD13 (SD_STATUS)
                        {
                            if (SDIO_only == true)
                            {
                                nbits = 32;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                ScanaStudio.dec_item_add_content("SD Status Register doesn't exist for SDIO card only");
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"CMD Argument","Unsupported command for SDIO card only","Error");
                                if (CMD_mode == 1)
                                {
                                    CMD_mode = 0;
                                }
                                state_machine = ENUM_STATE_CRC7;
                                break;
                            }
                            // Read Stuff bits
                            nbits = 32;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            ScanaStudio.dec_item_add_content("stuff bits (irrelevant)");
                            ScanaStudio.dec_item_add_content("no care");
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"Stuff Bit","Stuff Bits","Misc");
                            CMD_mode = 0;
                        }
                        CMD = -1;
                        state_machine = ENUM_STATE_CRC7;
                        break;
                    }

                    case 11 : //CMD11 (VOLTAGE_SWITCH)
                    case 19 : //CMD19 (SEND_TUNING_BLOCK)
                    case 42 : //CMD42 (LOCK_UNLOCK) and ACMD42 (SET_CLR_CARD_DETECT)
                    {
                        if (CMD == 42 && CMD_mode == 1)
                        {
                            if (SDIO_only == true)
                            {
                                nbits = 32;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                ScanaStudio.dec_item_add_content("Unsupported command for SDIO card only");
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"CMD Argument","Unsupported command for SDIO card only","Error");
                                if (CMD_mode == 1)
                                {
                                    CMD_mode = 0;
                                }
                                state_machine = ENUM_STATE_CRC7;
                                break;
                            }
                            // Read Reserved bits
                            nbits = 31;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            if (sdio_simple.unsigned_words == 0)
                            {
                                packet_string = "Reserved bits";
                                types = "Misc";
                                ScanaStudio.dec_item_add_content("Reserved bits");
                            }
                            else
                            {
                                packet_string = "Reserved bits should be 0";
                                types = "Error";
                                ScanaStudio.dec_item_add_content("Reserved bits should be 0");
                                ScanaStudio.dec_item_emphasize_error();
                            }
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"Reserved Bit",packet_string,types);
                            // Read set_cd bit
                            nbits = 1;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            if (sdio_simple.unsigned_words == 0)
                            {
                                packet_string = "Disconnect the 50KOhms pull up on DAT3";
                                ScanaStudio.dec_item_add_content("Disconnect the 50KOhms pull up on DAT3");
                            }
                            else
                            {
                                packet_string = "Connect the 50KOhms pull up on DAT3";
                                ScanaStudio.dec_item_add_content("Connect the 50KOhms pull up on DAT3");
                            }
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"set_cd",packet_string,"Data");
                            CMD_mode = 0;
                        }
                        else // CMD11/19/42
                        {
                            // Read Reserved bits
                            nbits = 32;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            if (sdio_simple.unsigned_words == 0)
                            {
                                packet_string = "Reserved bits";
                                types = "Misc";
                                ScanaStudio.dec_item_add_content("Reserved bits");
                            }
                            else
                            {
                                packet_string = "Reserved bits should be 0";
                                types = "Error";
                                ScanaStudio.dec_item_add_content("Reserved bits should be 0");
                                ScanaStudio.dec_item_emphasize_error();
                            }
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"Reserved Bit",packet_string,types);
                        }
                        CMD = -1;
                        state_machine = ENUM_STATE_CRC7;
                        break;
                    }//end case 11

                    case 16 : //CMD16 (SET_BLOCKLEN)
                    {
                        if (SDIO_only == true)
                        {
                            nbits = 32;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            ScanaStudio.dec_item_add_content("Unsupported command for SDIO card only");
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"CMD Argument","Unsupported command for SDIO card only","Error");
                            if (CMD_mode == 1)
                            {
                                CMD_mode = 0;
                            }
                            state_machine = ENUM_STATE_CRC7;
                            break;
                        }
                        // Read Block Length
                        nbits = 32;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (sdio_simple.unsigned_words > 512)
                        {
                            packet_string = "Too high block length";
                            types = "Error";
                            ScanaStudio.dec_item_add_content("Too high block length");
                        }
                        else
                        {
                            packet_string = "Block Length : "+ sdio_simple.unsigned_words;
                            types = "Data";
                            ScanaStudio.dec_item_add_content("Block Length : "+ sdio_simple.unsigned_words);
                            if (SD_CARD_TYPE == SDSC)
                            {
                                Block_length = sdio_simple.unsigned_words;
                                Lock_unlock_Block_length = sdio_simple.unsigned_words;
                            }
                            else
                            {
                                Block_length = 512;
                                Lock_unlock_Block_length = sdio_simple.unsigned_words;
                            }
                        }
                        ScanaStudio.dec_item_add_content("Block Length : "+ sdio_simple.unsigned_words);
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"BLOCK_LENGTH",packet_string,types);
                        CMD = -1;
                        state_machine = ENUM_STATE_CRC7;
                        break;
                    }//end case 16

                    case 17 : //CMD17 (READ_SINGLE_BLOCK)
                    case 18 : //CMD18 (READ_MULTIPLE_BLOCK)
                    case 24 : //CMD24 (WRITE_BLOCK)
                    case 25 : //CMD25 (WRITE_MULTIPLE_BLOCK)
                    case 28 : //CMD28 (SET_WRITE_PROT)
                    case 29 : //CMD29 (CLR_WRITE_PROT)
                    case 32 : //CMD32 (ERASE_WR_BLK_START)
                    case 33 : //CMD33 (ERASE_WR_BLK_END)
                    {
                        if (SDIO_only == true)
                        {
                            nbits = 32;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            ScanaStudio.dec_item_add_content("Unsupported command for SDIO card only");
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"CMD Argument","Unsupported command for SDIO card only","Error");
                            if (CMD_mode == 1)
                            {
                                CMD_mode = 0;
                            }
                            state_machine = ENUM_STATE_CRC7;
                            break;
                        }
                        // Read data adress
                        nbits = 32;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        sdio_value = Number(sdio_simple.unsigned_words);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("Data adress : 0x"+ pad(sdio_value.toString(16),8));
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "0x"+ pad(sdio_value.toString(16),8);
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Data Adress",packet_string,"Data");
                        if (CMD == 25 || CMD == 18 || CMD == 58 || CMD == 59)
                        {
                            Block_counter = 0;
                        }
                        CMD = -1;
                        state_machine = ENUM_STATE_CRC7;
                        break;
                    }//end case 17/18/24/25/28/29

                    case 30 : //CMD30 (SEND_WRITE_PROT)
                    {
                        // Read "write protect data adress"
                        nbits = 32;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("Data adress : "+ sdio_simple.unsigned_words);
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "Data adress : "+ sdio_simple.unsigned_words;
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"WR_PROTECT_DATA",packet_string,"Data");
                        CMD = -1;
                        state_machine = ENUM_STATE_CRC7;
                        break;
                    }//end case 30

                    case 20 : //CMD20 (SPEED_CLASS_CONTROL)
                    {
                        // Read Speed Class Control
                        nbits = 4;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("Speed Class Control : "+ sdio_simple.unsigned_words);
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "Speed Class Control : "+ sdio_simple.unsigned_words;
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"SPEED_CLASS",packet_string,"Data");
                        // Read Rserved bits
                        nbits = 28;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (sdio_simple.unsigned_words == 0)
                        {
                            packet_string = "Reserved bits";
                            types = "Misc";
                            ScanaStudio.dec_item_add_content("Reserved bits");
                        }
                        else
                        {
                            packet_string = "Reserved bits should be 0";
                            types = "Error";
                            ScanaStudio.dec_item_add_content("Reserved bits should be 0");
                            ScanaStudio.dec_item_emphasize_error();
                        }
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Reserved Bit",packet_string,types);
                        CMD = -1;
                        state_machine = ENUM_STATE_CRC7;
                        break;
                    }//end case 20

                    case 23 : //CMD23 and ACMD23
                    {
                        if (CMD_mode == 1) //ACMD23 (SET_WR_BLK_ERASE_COUNT)
                        {
                            // Read Stuff Bits
                            nbits = 9;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            ScanaStudio.dec_item_add_content("Stuff Bits");
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"Stuff Bit","Stuff Bits","Misc");
                            // Read Number of Block
                            nbits = 23;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            ScanaStudio.dec_item_add_content("Number of Block : " + sdio_simple.unsigned_words);
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_string = sdio_simple.unsigned_words + " Blocks";
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"WR_BLK_ERASE_COUNT",packet_string,"Data");
                            CMD = -1;
                            CMD_mode = 0; //Reset ACMD mode
                            state_machine = ENUM_STATE_CRC7;
                            break;
                        }
                        else //CMD23 (SET_BLOCK_COUNT)
                        {
                            // Read Block count
                            nbits = 32;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            ScanaStudio.dec_item_add_content("Block Count : " + sdio_simple.unsigned_words);
                            Block_count = Number(sdio_simple.unsigned_words);
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"BLOCK_COUNT", Block_count, "Data");
                            CMD = -1;
                            state_machine = ENUM_STATE_CRC7;
                            break;
                        }
                    }//end case 23

                    case 41 : //ACMD41 (SD_SEND_OP_COND)
                    {
                        if (CMD_mode == 1)
                        {
                            if (SDIO_only == true)
                            {
                                nbits = 32;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                ScanaStudio.dec_item_add_content("Unsupported command for SDIO card only");
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"CMD Argument","Unsupported command for SDIO card only","Error");
                                if (CMD_mode == 1)
                                {
                                    CMD_mode = 0;
                                }
                                state_machine = ENUM_STATE_CRC7;
                                break;
                            }
                            // Read Busy bit
                            nbits = 1;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            if (sdio_simple.unsigned_words == 0)
                            {
                                packet_string = "Busy";
                                types = "Misc";
                                ScanaStudio.dec_item_add_content("Busy ");
                            }
                            else
                            {
                                packet_string = "Should be 0";
                                types = "Error";
                                ScanaStudio.dec_item_add_content("Should be 0");
                                ScanaStudio.dec_item_emphasize_error();
                            }
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"Busy bit",packet_string,types);
                            // Read HCS bit
                            nbits = 1;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            if (sdio_simple.unsigned_words == 0)
                            {
                                packet_string = "Host Support Only SDSC";
                                types = "Data";
                                ScanaStudio.dec_item_add_content("Host Support Only SDSC");
                            }
                            else
                            {
                                packet_string = "Host Support SDHC or SDXC";
                                types = "Data";
                                ScanaStudio.dec_item_add_content("Host Support SDHC or SDXC");
                            }
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"HCS(OCR[30])",packet_string,types);
                            // Read (FB) bit
                            nbits = 1;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            if (sdio_simple.unsigned_words == 0)
                            {
                                packet_string = "Reserved bit";
                                types = "Misc";
                                ScanaStudio.dec_item_add_content("Reserved bit");
                            }
                            else
                            {
                                packet_string = "Should be 0";
                                types = "Error";
                                ScanaStudio.dec_item_add_content("Should be 0");
                                ScanaStudio.dec_item_emphasize_error();
                            }
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"eSD",packet_string,types);
                            // Read XPC bit
                            nbits = 1;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            if (sdio_simple.unsigned_words == 0)
                            {
                                packet_string = "Power control : Power saving";
                                types = "Data";
                                ScanaStudio.dec_item_add_content("Power control : Power saving ");
                                ScanaStudio.dec_item_add_content("Power saving");
                            }
                            else
                            {
                                packet_string = "Power control : Maximum performance";
                                types = "Data";
                                ScanaStudio.dec_item_add_content("Power control : Maximum performance");
                                ScanaStudio.dec_item_add_content("Maximum performance");
                            }
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"XPC",packet_string,types);
                            // Read Reserved bit
                            nbits = 3;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            if (sdio_simple.unsigned_words == 0)
                            {
                                packet_string = "Reserved bits";
                                types = "Misc";
                                ScanaStudio.dec_item_add_content("Reserved bits");
                            }
                            else
                            {
                                packet_string = "Reserved bits should be 0";
                                types = "Error";
                                ScanaStudio.dec_item_add_content("Reserved bits should be 0");
                                ScanaStudio.dec_item_emphasize_error();
                            }
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"Reserved",packet_string,types);
                            // Read Switching to 1.8V Request
                            nbits = 1;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            if (sdio_simple.unsigned_words == 0)
                            {
                                packet_string = "Use current signal voltage";
                                types = "Data";
                                ScanaStudio.dec_item_add_content("Use current signal voltage");
                            }
                            else
                            {
                                packet_string = "Switch to 1.8V signal voltage";
                                types = "Data";
                                ScanaStudio.dec_item_add_content("Switch to 1.8V signal voltage");
                            }
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"S18R",packet_string,types);
                            // Read OCR bits
                            nbits = 24;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            Voltage_window_24(item_display,sdio_simple,ch_cmd); //Display item content and packet view
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            CMD_mode = 0;
                            CMD = -1;
                            state_machine = ENUM_STATE_CRC7;
                            break;
                        }
                        else // CMD41 (Reserved)
                        {
                            nbits = 32;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            ScanaStudio.dec_item_add_content("Missing CMD55 before ACMD41");
                            ScanaStudio.dec_item_emphasize_warning();
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"CMD Argument","Missing CMD55 before ACMD41","Error");
                            CMD = -1;
                            state_machine = ENUM_STATE_CRC7;
                            break;
                        }
                    }//end case 41

                    // "Command Queue function" Commands related

                    case 43 : //CMD43 (Q_MANAGEMENT)
                    {
                        // Reserved bits
                        nbits = 11;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        reserved_bit(sdio_simple); // Create dec_item,content,samples, packet_view
                        // Read Task ID
                        nbits = 5;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        sdio_value = Number(sdio_simple.unsigned_words);
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("Task ID : 0b" + pad(sdio_value.toString(2),5));
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "0b" + pad(sdio_value.toString(2),5);
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Task ID",packet_string,"Data");
                                                                                                        //------------------------------------------------------------------------------------------//
                                                                                                        // Reserved bits (Couldn't find on specification what these bits represent)
                                                                                                        nbits = 12;
                                                                                                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                                                                                        if (last_trans == true) //if sync_decode overpassed the last sample
                                                                                                        {
                                                                                                            go_to_last_trans_cmd();
                                                                                                            state_machine = ENUM_STATE_DATA_START;
                                                                                                            break;
                                                                                                        }
                                                                                                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                                                                                        reserved_bit(sdio_simple); // Create dec_item,content,samples, packet_view
                                                                                                        //------------------------------------------------------------------------------------------//
                        // Read Operation Code  (Abort tasks etc.)
                        nbits = 4;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        sdio_value = Number(sdio_simple.unsigned_words);
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        item_content = operation_code(sdio_value);
                        ScanaStudio.dec_item_add_content("Queue Management Command : " + item_content);
                        ScanaStudio.dec_item_add_content("Operation Code : " + item_content);
                        ScanaStudio.dec_item_add_content(item_content);
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Operation Code",item_content,"Data");
                        CMD = -1;
                        state_machine = ENUM_STATE_CRC7;
                        break;
                    }//end CMD43

                    case 44 : //CMD44 (Q_TASK_INFO_A)
                    {
                        // Reserved bits
                        nbits = 1;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        reserved_bit(sdio_simple); // Create dec_item,content,samples, packet_view
                        // Read Direction
                        nbits = 1;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        sdio_value = Number(sdio_simple.unsigned_words);
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (sdio_value == 1)
                        {
                            packet_string = "Read";
                        }
                        else
                        {
                            packet_string = "Write";
                        }
                        ScanaStudio.dec_item_add_content("Direction : " + packet_string);
                        ScanaStudio.dec_item_add_content(packet_string);
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Direction",packet_string,"Data");
                        // Reserved bits
                        nbits = 6;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        reserved_bit(sdio_simple); // Create dec_item,content,samples, packet_view
                        // Read Priority
                        nbits = 1;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        sdio_value = Number(sdio_simple.unsigned_words);
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (sdio_value == 1)
                        {
                            packet_string = "Priority Request";
                        }
                        else
                        {
                            packet_string = "No priority";
                        }
                        ScanaStudio.dec_item_add_content("Priority : " + packet_string);
                        ScanaStudio.dec_item_add_content(packet_string);
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Priority",packet_string,"Data");
                        // Reserved bits
                        nbits = 2;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        reserved_bit(sdio_simple); // Create dec_item,content,samples, packet_view
                        // Read Task ID
                        nbits = 5;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("Task ID : 0b" + pad(sdio_value.toString(2),5));
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "0b" + pad(sdio_value.toString(2),5);
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Task ID",packet_string,"Data");
                        // Read Number of Block
                        nbits = 16;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("Number of block : " + sdio_simple.unsigned_words);
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = sdio_simple.unsigned_words;
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Number of block",packet_string,"Data");
                        CMD = -1;
                        state_machine = ENUM_STATE_CRC7;
                        break;
                    }//end CMD44

                    case 45 : //CMD45 (Q_TASK_INFO_B)
                    {
                        // Read Start block adress
                        nbits = 32;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        sdio_value = Number(sdio_simple.unsigned_words);
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("Starting adress : 0x" + pad(sdio_value.toString(16),8));
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "Starting adress : 0x" + pad(sdio_value.toString(16),8);
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Start block adress",packet_string,"Data");
                        CMD = -1;
                        state_machine = ENUM_STATE_CRC7;
                        break;
                    }//end CMD45

                    case 46 : //CMD46 (Q_RD_TASK)
                    {
                        // Reserved bits
                        nbits = 11;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        reserved_bit(sdio_simple); // Create dec_item,content,samples, packet_view
                        // Read Task ID
                        nbits = 5;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        sdio_value = Number(sdio_simple.unsigned_words);
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("Task ID : 0b" + pad(sdio_value.toString(2),5));
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "0b" + pad(sdio_value.toString(2),5);
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Task ID",packet_string,"Data");
                        // Reserved bits
                        nbits = 16;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        reserved_bit(sdio_simple); // Create dec_item,content,samples, packet_view
                        CMD = -1;
                        state_machine = ENUM_STATE_CRC7;
                        break;
                    }//end CMD46

                    case 47 : //CMD47 (Q_WR_TASK)
                    {
                        // Reserved bits
                        nbits = 11;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        reserved_bit(sdio_simple); // Create dec_item,content,samples, packet_view
                        // Read Task ID
                        nbits = 5;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        sdio_value = Number(sdio_simple.unsigned_words);
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("Task ID : 0b" + pad(sdio_value.toString(2),5));
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "0b" + pad(sdio_value.toString(2),5);
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Task ID",packet_string,"Data");
                        // Reserved bits
                        nbits = 16;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        reserved_bit(sdio_simple); // Create dec_item,content,samples, packet_view
                        CMD = -1;
                        state_machine = ENUM_STATE_CRC7;
                        break;
                    }//end CMD47

                    // Function Extension Commands (class 11)

                    case 48 : //CMD48 (READ_EXTR_SINGLE)
                    {
                        // Read MIO (Memory or IO)
                        nbits = 1;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        MIO_value = Number(sdio_simple.unsigned_words);
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (MIO_value == 1)
                        {
                            packet_string = "I/O Extension";
                        }
                        else
                        {
                            packet_string = "Memory Extension";
                        }
                        ScanaStudio.dec_item_add_content("MIO : " + packet_string);
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"MIO",packet_string,"Data");
                        // Read FNO (Function No.)
                        nbits = 4;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        item_content = FNO(item_display, MIO_value);
                        ScanaStudio.dec_item_add_content("FNO : " + item_content);

                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"FNO",item_content,"Data");
                        // Reserved bits
                        nbits = 1;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        reserved_bit(sdio_simple); // Create dec_item,content,samples, packet_view
                        // Read ADDR (Adress)
                        nbits = 17;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        sdio_value = Number(sdio_simple.unsigned_words);
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("Adress : 0x" + pad(sdio_value.toString(16),5));
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "Adress : 0x" + pad(sdio_value.toString(16),5);
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"ADDR",packet_string,"Data");
                        // Read LEN ()
                        nbits = 9;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        sdio_value = Number(sdio_simple.unsigned_words);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("Effective Data Read : " + (sdio_value+1) + "Bytes");
                        ScanaStudio.dec_item_add_content("Length : " + (sdio_value+1) + "Bytes");
                        ScanaStudio.dec_item_add_content((sdio_value+1) + "Bytes");
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "Effective Data Read : " + sdio_value + "Bytes";
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"LEN",packet_string,"Data");
                        CMD = -1;
                        state_machine = ENUM_STATE_CRC7;
                        break;
                    }//end CMD48

                    case 49 : //CMD49 (WRITE_EXTR_SINGLE)
                    {
                        // Read MIO (Memory or IO)
                        nbits = 1;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        MIO_value = Number(sdio_simple.unsigned_words);
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (MIO_value == 1)
                        {
                            packet_string = "I/O Extension";
                        }
                        else
                        {
                            packet_string = "Memory Extension";
                        }
                        ScanaStudio.dec_item_add_content("MIO : " + packet_string);
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"MIO",packet_string,"Data");
                        // Read FNO (Function No.)
                        nbits = 4;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        item_content = FNO(item_display, MIO_value);
                        ScanaStudio.dec_item_add_content("FNO : " + item_content);

                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"FNO",item_content,"Data");
                        // Read MW (Mask Write Mode)
                        nbits = 1;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        var MW = Number(sdio_simple.unsigned_words);
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (MW == 0)
                        {
                            packet_string = "Mask Disabled";
                            ScanaStudio.dec_item_add_content("Mask Disabled (Length is set to 16-08)");
                            ScanaStudio.dec_item_add_content("Mask Disabled");
                        }
                        else
                        {
                            packet_string = "Mask Enabled";
                            ScanaStudio.dec_item_add_content("Mask Enabled (Mask is set to 15-08),Length is fixed to 1");
                            ScanaStudio.dec_item_add_content("Mask Enabled");
                        }
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"MW",packet_string,"Data");
                        // Read ADDR (Adress)
                        nbits = 17;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        sdio_value = Number(sdio_simple.unsigned_words);
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("Adress : 0x" + pad(sdio_value.toString(16),5));
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "Adress : " + pad(sdio_value.toString(16),5);
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"ADDR",packet_string,"Data");
                        // Read LEN/MASK ()
                        nbits = 9;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        item_content = "";
                        for(i=1; i<9; i++)
                        {
                            item_content += item_display[i];
                        }
                        sdio_value = Number(sdio_simple.unsigned_words);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if(item_display[0] == 1)
                        {
                            packet_string = "Write 0b" + item_content;
                            ScanaStudio.dec_item_add_content(packet_string);
                        }
                        else
                        {
                            packet_string = "Register bit stay unchanged";
                            ScanaStudio.dec_item_add_content(packet_string);
                        }
                        display_sample_0_1(sdio_simple,item_display);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"LEN/MASK",packet_string,"Data");
                        state_machine = ENUM_STATE_CRC7;
                        CMD = -1;
                        break;
                    }//end CMD49

                    case 58 : //CMD58 (READ_EXTR_MULTI)
                    {
                        // Read MIO (Memory or IO)
                        nbits = 1;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        MIO_value = Number(sdio_simple.unsigned_words);
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (MIO_value == 1)
                        {
                            packet_string = "I/O Extension";
                        }
                        else
                        {
                            packet_string = "Memory Extension";
                        }
                        ScanaStudio.dec_item_add_content("MIO : " + packet_string);
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"MIO",packet_string,"Data");
                        // Read FNO (Function No.)
                        nbits = 4;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        item_content = FNO(item_display, MIO_value);
                        ScanaStudio.dec_item_add_content("FNO : " + item_content);

                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"FNO",item_content,"Data");
                        // Read BUS (Function No.)
                        nbits = 1;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        sdio_value = Number(sdio_simple.unsigned_words);
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (sdio_value == 0)
                        {
                            item_content = "512Bytes";
                        }
                        else
                        {
                            item_content = "32KBytes";
                        }
                        ScanaStudio.dec_item_add_content("Block Unit Select : " + item_content);
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "Block Unit Select : " + item_content;
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"BUS",packet_string,"Data");
                        // Read ADDR (Adress)
                        nbits = 17;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        sdio_value = Number(sdio_simple.unsigned_words);
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("Adress : 0x" + pad(sdio_value.toString(16),5));
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "Adress : 0x" + pad(sdio_value.toString(16),5);
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"ADDR",packet_string,"Data");
                        // Read BUC (Block Unit Count)
                        nbits = 9;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        sdio_value = Number(sdio_simple.unsigned_words);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("Block Unit Count : " + (sdio_value+1) + "Blocks");
                        ScanaStudio.dec_item_add_content("BUC : " + (sdio_value+1) + "Blocks");
                        ScanaStudio.dec_item_add_content((sdio_value+1) + "Blocks");
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "Effective Data Read : " + sdio_value + "Bytes";
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"LEN",packet_string,"Data");
                        CMD = -1;
                        state_machine = ENUM_STATE_CRC7;
                        break;
                    }//end CMD58

                    case 59 : //CMD59 (WRITE_EXTR_MULTI)
                    {
                        // Read MIO (Memory or IO)
                        nbits = 1;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        MIO_value = Number(sdio_simple.unsigned_words);
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (MIO_value == 1)
                        {
                            packet_string = "I/O Extension";
                        }
                        else
                        {
                            packet_string = "Memory Extension";
                        }
                        ScanaStudio.dec_item_add_content("MIO : " + packet_string);
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"MIO",packet_string,"Data");
                        // Read FNO (Function No.)
                        nbits = 4;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        item_content = FNO(item_display, MIO_value);
                        ScanaStudio.dec_item_add_content("FNO : " + item_content);

                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"FNO",item_content,"Data");
                        // Read BUS (Function No.)
                        nbits = 1;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        sdio_value = Number(sdio_simple.unsigned_words);
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (sdio_value == 0)
                        {
                            item_content = "512Bytes";
                        }
                        else
                        {
                            item_content = "32KBytes";
                        }
                        ScanaStudio.dec_item_add_content("Block Unit Select : " + item_content);
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "Block Unit Select : " + item_content;
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"BUS",packet_string,"Data");
                        // Read ADDR (Adress)
                        nbits = 17;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("Adress : 0x" + pad(sdio_value.toString(16),5));
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "Adress : 0x" + pad(sdio_value.toString(16),5);
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"ADDR",packet_string,"Data");
                        // Read BUC (Block Unit Count)
                        nbits = 9;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        sdio_value = Number(sdio_simple.unsigned_words);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("Block Unit Count : " + (sdio_value+1) + "Blocks");
                        ScanaStudio.dec_item_add_content("BUC : " + (sdio_value+1) + "Blocks");
                        ScanaStudio.dec_item_add_content((sdio_value+1) + "Blocks");
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "Effective Data Read : " + sdio_value + "Bytes";
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"LEN",packet_string,"Data");
                        CMD = -1;
                        state_machine = ENUM_STATE_CRC7;
                        break;
                    }//end CMD59

                    case 52 : //CMD52 (IO_RW_DIRECT)
                    {
                        // Read R/W bit
                        nbits = 1;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (sdio_simple.unsigned_words == 1)
                        {
                            packet_string = "R/W = Write";
                            types = "Data";
                            ScanaStudio.dec_item_add_content("R/W = Write");
                            ScanaStudio.dec_item_add_content("Write");
                            R_W = 1;
                        }
                        else
                        {
                            packet_string = "R/W = Read";
                            types = "Data";
                            ScanaStudio.dec_item_add_content("R/W = Read");
                            ScanaStudio.dec_item_add_content("Read");
                            R_W = 0;
                        }
                        ScanaStudio.dec_item_add_sample_point(sdio_simple.start_sample,"P");
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"R/W",packet_string,types);
                        // Read Function number
                        nbits = 3;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        function_number = Number(sdio_simple.unsigned_words);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("Function " + sdio_simple.unsigned_words);
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "Function " + sdio_simple.unsigned_words;
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Function Number",packet_string,types);
                        // Read RAW flag
                        nbits = 1;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        crc_calcul.push(sdio_simple.unsigned_words);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (sdio_simple.unsigned_words == 1)
                        {
                            packet_string = "RAW = 1";
                            types = "Data";
                            ScanaStudio.dec_item_add_content("RAW = 1");
                            RAW = 1;
                        }
                        else
                        {
                            packet_string = "RAW = 0";
                            types = "Data";
                            ScanaStudio.dec_item_add_content("RAW = 0");
                            RAW = 0;
                        }
                        ScanaStudio.dec_item_add_sample_point(sdio_simple.start_sample,"P");
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"RAW",packet_string,types);
                        // Read stuff bit
                        nbits = 1;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        crc_calcul.push(sdio_simple.unsigned_words);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("Stuff bit");
                        ScanaStudio.dec_item_add_sample_point(sdio_simple.start_sample,"P");
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Reserved Bit","Stuff bit","Misc");
                        // Read Register adress
                        nbits = 17;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        sdio_value = Number(sdio_simple.unsigned_words);
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        register_adress = sdio_simple.unsigned_words;
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("Register adress is " + sdio_simple.unsigned_words + " or 0h" + pad(sdio_value.toString(16),5));
                        ScanaStudio.dec_item_add_content("Register adress is 0h" + pad(sdio_value.toString(16),5));
                        ScanaStudio.dec_item_add_content("0h" + pad(sdio_value.toString(16),5));
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = sdio_value + " or 0h" + pad(sdio_value.toString(16),5);
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Register Adress",packet_string,"Data");
                        // Read Stuff bit
                        nbits = 1;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        crc_calcul.push(sdio_simple.unsigned_words);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("Stuff bit");
                        ScanaStudio.dec_item_add_sample_point(sdio_simple.start_sample,"P");
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Stuff Bit","Stuff bit","Misc");
                        // Read Write Data or stuff bits
                        nbits = 8;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (R_W == 1)
                        {
                            packet_string = "Write : " + sdio_simple.unsigned_words;
                            types = "Data";
                            ScanaStudio.dec_item_add_content("Write : " + sdio_simple.unsigned_words);
                            Write_data = sdio_simple.unsigned_words;
                        }
                        else
                        {
                            packet_string = "Stuff bits";
                            types = "Misc";
                            ScanaStudio.dec_item_add_content("Stuff bits");
                        }
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Write_data/Stuff bit",packet_string,types);
                        CMD = -1;
                        state_machine = ENUM_STATE_CRC7;
                        break;
                    }//end case 52

                    case 53 : //CMD53
                    {
                        // Read R/W bit
                        nbits = 1;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        crc_calcul.push(sdio_simple.unsigned_words);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (sdio_simple.unsigned_words == 1)
                        {
                            packet_string = "R/W = Write";
                            types = "Data";
                            ScanaStudio.dec_item_add_content("R/W = Write");
                            ScanaStudio.dec_item_add_content("Write");
                            R_W = 1;
                        }
                        else
                        {
                            packet_string = "R/W = Read";
                            types = "Data";
                            ScanaStudio.dec_item_add_content("R/W = Read");
                            ScanaStudio.dec_item_add_content("Read");
                            R_W = 0;
                        }
                        ScanaStudio.dec_item_add_sample_point(sdio_simple.start_sample,"P");
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"R/W",packet_string,types);
                        // Read Function number
                        nbits = 3;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        function_number = sdio_simple.unsigned_words;
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (function_number == 0)
                        {
                            ScanaStudio.dec_item_add_content("Function " + sdio_simple.unsigned_words + " (CIA)");
                        }
                        else
                        {
                            ScanaStudio.dec_item_add_content("Function " + sdio_simple.unsigned_words + " (Register Space)");
                        }
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "Function " + sdio_simple.unsigned_words;
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Function_number",packet_string,"Data");
                        // Read Block Mode
                        nbits = 1;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        crc_calcul.push(sdio_simple.unsigned_words);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (sdio_simple.unsigned_words == 1)
                        {
                            packet_string = "Block Mode = 1 (block basis)";
                            types = "Data";
                            ScanaStudio.dec_item_add_content("Block Mode = 1 (block basis)");
                            ScanaStudio.dec_item_add_content("Block basis");
                            Block_mode = 1;
                        }
                        else
                        {
                            packet_string = "Block Mode = 0 (byte basis)";
                            types = "Data";
                            ScanaStudio.dec_item_add_content("Block Mode = 0 (byte basis)");
                            ScanaStudio.dec_item_add_content("Byte basis");
                            Block_mode = 0;
                        }
                        ScanaStudio.dec_item_add_sample_point(sdio_simple.start_sample,"P");
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Block_mode",packet_string,types);
                        // Read OP Code
                        nbits = 1;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        crc_calcul.push(sdio_simple.unsigned_words);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (sdio_simple.unsigned_words == 1)
                        {
                            packet_string = "OP Code = 1 (fixed adress)";
                            types = "Data";
                            ScanaStudio.dec_item_add_content("OP Code = 1 (fixed adress)");
                            ScanaStudio.dec_item_add_content("Fixed adress");
                            OP_code = 1;
                        }
                        else
                        {
                            packet_string = "OP Code = 0 (incrementing adress)";
                            types = "Data";
                            ScanaStudio.dec_item_add_content("OP Code = 0 (incrementing adress)");
                            ScanaStudio.dec_item_add_content("Incrementing adress");
                            OP_code = 0;
                        }
                        ScanaStudio.dec_item_add_sample_point(sdio_simple.start_sample,"P");
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"OP_CODE",packet_string,types);
                        // Read Register adress
                        nbits = 17;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        register_adress = Number(sdio_simple.unsigned_words);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("Register adress is " + sdio_simple.unsigned_words);
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "Register adress is " + sdio_simple.unsigned_words;
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Register adress",packet_string,"Data");
                        // Read Block Count
                        nbits = 9;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        var CMD53_Block_count = Number(sdio_simple.unsigned_words);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (Block_mode == 1)
                        {
                            if (CMD53_Block_count == 0)
                            {
                                Block_count = -1; // -1 means infinite, it transfer block until we write to the I/O abort function select bits (ASx) in the CCCR
                            }
                            else
                            {
                                Block_count = CMD53_Block_count;
                            }
                            packet_string = "Block Count : " + sdio_simple.unsigned_words;
                            types = "Data";
                            ScanaStudio.dec_item_add_content("Block Count : " + sdio_simple.unsigned_words);
                            Write_data = sdio_simple.unsigned_words;
                        }
                        else
                        {
                            if (CMD53_Block_count == 0)
                            {
                                Block_count = 512;
                            }
                            else
                            {
                                Block_count = CMD53_Block_count;
                            }
                            packet_string = "Byte Count : " + sdio_simple.unsigned_words;
                            types = "Data";
                            ScanaStudio.dec_item_add_content("Byte Count : " + sdio_simple.unsigned_words);
                        }
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Block/Byte Count",packet_string,types);
                        CMD = -1;
                        state_machine = ENUM_STATE_CRC7;
                        break;
                    }//end case 53

                    case 56 : //CMD56
                    {
                        // Read stuff bits
                        nbits = 31;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("Stuff bits");
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Reserved Bit","Stuff bits","Misc");
                        // Read Register adress
                        nbits = 1;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        register_adress = sdio_simple.unsigned_words;
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (sdio_simple.unsigned_words == 0)
                        {
                            packet_string = "Writing";
                            types = "Data";
                            ScanaStudio.dec_item_add_content("Writing");
                        }
                        else
                        {
                            packet_string = "Reading";
                            types = "Data";
                            ScanaStudio.dec_item_add_content("Reading");
                        }
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"RD/WR",packet_string,types);
                        CMD = -1;
                        state_machine = ENUM_STATE_CRC7;
                        break;
                    }//end case 56

                    default :
                    {
                        nbits = 32;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("Reserved command");
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"CMD Argument","Reserved command","Misc");
                        if (CMD_mode == 1)
                        {
                            CMD_mode = 0;
                        }
                        state_machine = ENUM_STATE_CRC7;
                        break;
                    }
                }//end third switch (Number(CMD))
                break;
            }//end ENUM_STATE_CMD_ARGUMENT

            case ENUM_STATE_RSP_ARGUMENT :
            {
                switch(R_type)
                {
                    case "R1" : // Looking for card status
                    {
                        str_error = "";
                        nbits = 32;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (send_CQ == true)
                        {
                            str_error = task_status_error_32(item_display, sdio_simple);
                            send_CQ = false;
                        }
                        else
                        {
                            str_error = card_status_error_32(item_display, sdio_simple);
                        }
                        item_display = [];
                        R_type = "Undefined";
                        state_machine = ENUM_STATE_CRC7;
                        break;
                    }//end case "R1"

                    case "R1b" : // Looking for card status
                    {
                        //Difference between R1 and R1b should be a possible busy bit on the DAT0 line
                        nbits = 32;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (send_CQ == true)
                        {
                            str_error = task_status_error_32(item_display, sdio_simple);
                            send_CQ = false;
                        }
                        else
                        {
                            str_error = card_status_error_32(item_display, sdio_simple);
                        }
                        R_type = "Undefined";
                        state_machine = ENUM_STATE_CRC7;
                        break;
                    }//end case "R1"

                    case "R2" : // Looking for CID or CSD
                    {
                        crc_calcul = [];
                        if (last_CMD == 2 || last_CMD == 10) //CID REGISTER
                        {
                            // Manufacturer ID
                            nbits = 8;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            sdio_value = Number(sdio_simple.unsigned_words);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            ScanaStudio.dec_item_add_content("Manufacturer ID : 0x"+ pad(sdio_value.toString(16),2) + " or 0b" + pad(sdio_value.toString(2),8));
                            ScanaStudio.dec_item_add_content("Manufacturer ID : 0b" + pad(sdio_value.toString(2),8));
                            ScanaStudio.dec_item_add_content("Manu ID : 0b" + pad(sdio_value.toString(2),8));
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_string = "0x"+ pad(sdio_value.toString(16),2) + " or 0b" + pad(sdio_value.toString(2),8);
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"MID",packet_string,"Data");
                            // OEM/Application ID
                            nbits = 16;
                            var content = "";
                            var sampling_point = [];
                            for (n=0; n<nbits/8; n++)
                            {
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample + 1,8);
                                if (n == 0)
                                {
                                    item_start_sample = sdio_simple.start_sample;
                                }
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,8,crc_calcul);
                                for (k=0; k<8; k++)
                                {
                                    sampling_point.push(sdio_simple.sampling_points[k]);
                                }
                                content += String.fromCharCode(sdio_simple.unsigned_words) ;
                            }
                            sdio_simple.sampling_points = sampling_point;
                            // Peut etre faut l'enlever mais il fait pas de mal atm
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_start_sample = trs_clk_before_v2(item_start_sample + 1);
                            item_end_sample = trs_clk_after_v2(sdio_simple.end_sample + 1);
                            ScanaStudio.dec_item_new(ch_cmd,item_start_sample,item_end_sample);
                            ScanaStudio.dec_item_add_content("OEM Application ID : " + content);
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_string = "OEM Application ID : " + content;
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"OID",packet_string,"Data");
                            // Product Name
                            nbits = 40;
                            var content = "";
                            var sampling_point = [];
                            for (n=0; n<nbits/8; n++)
                            {
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,8);
                                if (n == 0)
                                {
                                    item_start_sample = sdio_simple.start_sample;
                                }
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,8,crc_calcul);
                                for (k=0; k<8; k++)
                                {
                                    sampling_point.push(sdio_simple.sampling_points[k]);
                                }
                                content += String.fromCharCode(sdio_simple.unsigned_words) ;
                            }
                            sdio_simple.sampling_points = sampling_point;
                            // Peut etre faut l'enlever mais il fait pas de mal atm
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_start_sample = trs_clk_before_v2(item_start_sample + 1);
                            item_end_sample = trs_clk_after_v2(sdio_simple.end_sample + 1);
                            ScanaStudio.dec_item_new(ch_cmd,item_start_sample, item_end_sample);
                            ScanaStudio.dec_item_add_content("Product Name : " + content);
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_string = "Product Name : " + content;
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"PNM",packet_string,"Data");
                            // Product Revision
                            nbits = 8;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            var PRV_1_array = [];
                            var PRV_2_array = [];
                            for (k=0; k<nbits; k++)
                            {
                                if (k <4)
                                {
                                    PRV_1_array.push(item_display[k]);
                                }

                                else
                                {
                                    PRV_2_array.push(item_display[k]);
                                }
                            }
                            var PRV_1 = bin2dec(PRV_1_array,4);
                            var PRV_2 = bin2dec(PRV_2_array,4);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            ScanaStudio.dec_item_add_content("Product Revision : "+ PRV_1 + "." + PRV_2);
                            ScanaStudio.dec_item_add_content("PR : "+ PRV_1 + "." + PRV_2);
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_string = "Product Revision : "+ PRV_1 + "." + PRV_2;
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"PRV",packet_string,"Data");
                            // Product Serial Number
                            nbits = 32;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            sdio_value = Number(sdio_simple.unsigned_words);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            ScanaStudio.dec_item_add_content("Product Serial Number : 0b" + pad(sdio_value.toString(2),32));
                            ScanaStudio.dec_item_add_content("PSN : 0b" + pad(sdio_value.toString(2),32));
                            display_sample_0_1(sdio_simple, item_display);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_string ="0x" + pad(sdio_value.toString(16),8);
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"PSN",packet_string,"Data");
                            // Reserved bits
                            nbits = 4;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            ScanaStudio.dec_item_add_content("Reserved Bits");
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_string = "Reserved Bits";
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"Reserved Bit",packet_string,"Misc");
                            // Manufacturing Date
                            nbits = 12;
                            var Year_array = [];
                            var Month_array = [];
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            for (k=0; k<nbits; k++)
                            {
                                if (k <8)
                                {
                                    Year_array.push(item_display[k]);
                                }
                                else
                                {
                                    Month_array.push(item_display[k]);
                                }
                            }
                            var year = bin2dec(Year_array,8) + 2000;
                            var month = bin2dec(Month_array,4);
                            dec_item_new_v2(ch_cmd,sdio_simple);
                            ScanaStudio.dec_item_add_content("Manufacturing Date : " + year + "/" + month + " (y/m)");
                            ScanaStudio.dec_item_add_content("M.D : " + year + "/" + month + " (y/m)");
                            display_sample(sdio_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_string = year + "/" + month + " (y/m)";
                            packet_view_add_packet_v2(ch_cmd,sdio_simple,"Manufacturing Date",packet_string,"Data");
                        }
                        // -----------------------------------------------------------------------------------------------------------------------------------------------------------------//
                        // -----------------------------------------------------------------------------------------------------------------------------------------------------------------//
                        else if (last_CMD == 9)// CSD REGISTER
                        {
                            // CSD Version
                            nbits = 2;
                            sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_cmd();
                                state_machine = ENUM_STATE_DATA_START;
                                break;
                            }
                            item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                            var CSD_version = Number(sdio_simple.unsigned_words);
                             dec_item_new_v2(ch_cmd,sdio_simple);

                            if (CSD_version == 0) // If it's the 1.0 Version of the CSD
                            {
                                ScanaStudio.dec_item_add_content("CSD Version 1.0 : Standard Capacity ") ;
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = "CSD Version 1.0";
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"CSD_STRUCTURE",packet_string,"Data");
                                // Product Reserved bits
                                nbits = 6;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                reserved_bit(sdio_simple); // Create Item, display content and samples, create packet_view
                                // Data Read access time-1 (TAAC)
                                nbits = 8;
                                var time_unit_array = [];
                                var time_value_array = [];
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                for (k=0; k<nbits; k++)
                                {
                                    if (k>0 && k<4)
                                    {
                                        time_value_array.push(item_display[k]);
                                    }
                                    else if (k>3 && k<8)
                                    {
                                        time_unit_array.push(item_display[k]);
                                    }
                                }
                                var time_value = time_value_switch(bin2dec(time_value_array,4));
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                var string_content = time_unit_switch(bin2dec(time_unit_array,3), time_value, sdio_simple); // Display dec_item, samples, packet_view
                                // Data Read access time-2 in CLK cycles (NSAC*100) (NSAC)
                                nbits = 8;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                var NSAC = 100*Number(sdio_simple.unsigned_words);
                                sdio_value = Number(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                ScanaStudio.dec_item_add_content("Data Read access time-2 (NSAC) : 0h" + pad(sdio_value.toString(16),2) + " or " + NSAC + " Clock Cycles");
                                ScanaStudio.dec_item_add_content("NSAC : 0h" + pad(sdio_value.toString(16),2));
                                display_sample(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = "NSAC : 0h" + pad(sdio_value.toString(16),2) + " or " + NSAC;
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"NSAC",packet_string,"Data");
                                // Max data transfer rate (TRAN_SPEED)
                                nbits = 8;
                                var transfer_rate_unit_array = [];
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                for (k=0; k<nbits; k++)
                                {
                                    if (k>0 && k<5)
                                    {
                                        time_value_array.push(item_display[k]);
                                    }
                                    else if (k>4 && k<8)
                                    {
                                        transfer_rate_unit_array.push(item_display[k]);
                                    }
                                }
                                time_value = time_value_switch(bin2dec(time_value_array,4));
                                item_content = transfer_rate_switch(bin2dec(transfer_rate_unit_array,3), time_value);
                                sdio_value = Number(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if ((sdio_value == 50) ||  (sdio_value == 90))
                                {
                                    packet_string = "TRAN_SPEED : 0h" + pad(sdio_value.toString(16),2) + " or " + item_content;
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("Max data transfer rate (TRAN_SPEED) : 0h" + pad(sdio_simple.unsigned_words.toString(16),2) + " or " + item_content);
                                    ScanaStudio.dec_item_add_content("TRAN_SPEED : 0h" + pad(sdio_simple.unsigned_words.toString(16),2) + " or " + item_content);
                                }
                                else
                                {
                                    packet_string = "0h" + pad(sdio_value.toString(16),2) + " is an invalid transfer rate";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("0h" + pad(sdio_value.toString(16),2) + " is an invalid transfer rate");
                                    ScanaStudio.dec_item_emphasize_error();
                                }
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"TRAN_SPEED",packet_string,types);
                                // Card Command Class (CCC)
                                nbits = 12;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                sdio_value = Number(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if ((sdio_value == 1461) || (sdio_value == 1973))
                                {
                                    packet_string = "Card Command Class (CCC) : 0b" + pad(sdio_value.toString(2),12);
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("Card Command Class (CCC) : 0b" + pad(sdio_value.toString(2),12));
                                    ScanaStudio.dec_item_add_content("CCC : 0b" + pad(sdio_value.toString(2),12));
                                    pad(sdio_value.toString(16),3)
                                }
                                else
                                {
                                    packet_string = "Invalid Card Command Class";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("Invalid Card Command Class");
                                    ScanaStudio.dec_item_emphasize_error();
                                }
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"CCC",packet_string,types);
                                // Max Read data block length (READ_BL_LEN)
                                nbits = 4;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                sdio_value = Number(sdio_simple.unsigned_words);
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                var item_content = BL_LEN(sdio_value, CSD_version);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                ScanaStudio.dec_item_add_content("Max Read data block length : " + item_content);
                                ScanaStudio.dec_item_add_content("Max block length : " + item_content);
                                ScanaStudio.dec_item_add_content("Max block : " + item_content);
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = item_content;
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"READ_BL_LEN",packet_string,"Data");
                                // Partial Read for read allowed (READ_BL_PARTIAL)
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (sdio_simple.unsigned_words == 1)
                                {
                                    packet_string = "Partial Block Read is allowed";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("Partial Block Read is allowed (min block size will be 1 byte) ");
                                    ScanaStudio.dec_item_add_content("Partial Block Read is allowed");
                                }
                                else
                                {
                                    packet_string = "Partial Block Read isn't allowed";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("Partial Block Read isn't allowed (on SD memory Card it should)");
                                    ScanaStudio.dec_item_add_content("Partial Block Read isn't allowed");
                                    ScanaStudio.dec_item_emphasize_error();
                                }
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"Reserved Bit",packet_string,types);
                                // Write Block Misalignement (WRITE_BLK_MISALIGN)
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (sdio_simple.unsigned_words == 1)
                                {
                                    packet_string = "Signal out boundaries is allowed";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("Signals that crossing physical block boundaries is allowed");
                                    ScanaStudio.dec_item_add_content("Signals crossing block boundaries is allowed");
                                }
                                else
                                {
                                    packet_string = "Signal out boundaries is invalid";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("Signals that crossing physical block boundaries is invalid");
                                    ScanaStudio.dec_item_add_content("Signals crossing block boundaries is invalid");
                                }
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"WRITE_BLK_MISALIGN",packet_string,"Data");
                                // Read Block Misalignement (READ_BLK_MISALIGN)
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (sdio_simple.unsigned_words == 1)
                                {
                                    packet_string = "Signal out boundaries is allowed";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("Signals that crossing physical block boundaries is allowed");
                                    ScanaStudio.dec_item_add_content("Signals crossing block boundaries is allowed");
                                }
                                else
                                {
                                    packet_string = "Signal out boundaries is invalid";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("Signals that crossing physical block boundaries is invalid");
                                    ScanaStudio.dec_item_add_content("Signals crossing block boundaries is invalid");
                                }
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"READ_BLK_MISALIGN",packet_string,"Data");
                                // DSR implemented (DSR_IMP)
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (sdio_simple.unsigned_words == 1)
                                {
                                    packet_string = "DSR implemented";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("DSR implemented");
                                }
                                else
                                {
                                    packet_string = "DSR not implemented";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("DSR not implemented");
                                }
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"DSR_IMP",packet_string,"Data");
                                // Reserved bits
                                nbits = 2;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                reserved_bit(sdio_simple);
                                // Device Size (C_SIZE)
                                nbits = 12;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                sdio_value = Number(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                ScanaStudio.dec_item_add_content("Device Size (C_SIZE) : 0h" + pad(sdio_value.toString(16),3));
                                ScanaStudio.dec_item_add_content("C_SIZE : 0h" + pad(sdio_value.toString(16),3));
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = "C_SIZE : 0h" + pad(sdio_value.toString(16),3);
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"Reserved Bit",packet_string,"Data");
                                // Min Read current (VDD_R_CURR_MIN)
                                nbits = 3;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                item_content = VDD_CURR_MIN(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                ScanaStudio.dec_item_add_content("Min Read current (VDD_R_CURR_MIN): " + item_content);
                                ScanaStudio.dec_item_add_content("VDD_R_CURR_MIN : " + item_content);
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = "Min Read current : " + item_content;
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"VDD_R_CURR_MIN",packet_string,"Data");
                                // Max Read current (VDD_R_CURR_MIN)
                                nbits = 3;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                item_content = VDD_CURR_MAX(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                ScanaStudio.dec_item_add_content("Max Read current (VDD_R_CURR_MAX): " + item_content);
                                ScanaStudio.dec_item_add_content("VDD_R_CURR_MAX : " + item_content);
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = "Max Read current : " + item_content;
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"VDD_R_CURR_MAX",packet_string,"Data");
                                // Min Write current (VDD_W_CURR_MIN)
                                nbits = 3;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                item_content = VDD_CURR_MIN(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                ScanaStudio.dec_item_add_content("Min Write current (VDD_W_CURR_MIN): " + item_content);
                                ScanaStudio.dec_item_add_content("VDD_W_CURR_MIN : " + item_content);
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = "Min Write current : " + item_content;
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"VDD_W_CURR_MIN",packet_string,"Data");
                                // Max Write current (VDD_W_CURR_MIN)
                                nbits = 3;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                item_content = VDD_CURR_MAX(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                ScanaStudio.dec_item_add_content("Max Write current (VDD_W_CURR_MAX): " + item_content);
                                ScanaStudio.dec_item_add_content("VDD_W_CURR_MAX : " + item_content);
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = "Max Write current : " + item_content;
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"VDD_W_CURR_MAX",packet_string,"Data");
                                // Devic Size Multiplier (C_SIZE_MULT)
                                nbits = 3;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                ScanaStudio.dec_item_add_content("Devic Size Multiplier (C_SIZE_MULT): " + Math.pow(2,sdio_simple.unsigned_words + 2));
                                ScanaStudio.dec_item_add_content("C_SIZE_MULT : " + Math.pow(2,sdio_simple.unsigned_words + 2));
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = Math.pow(2,sdio_simple.unsigned_words + 2);
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"C_SIZE_MULT",packet_string,"Data");
                                // Erase Single Block Enable (ERASE_BLK_EN)
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                item_content = ERASE_BLK_EN(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                ScanaStudio.dec_item_add_content("Erase Single Block Enable (ERASE_BLK_EN) : " + item_content);
                                ScanaStudio.dec_item_add_content("(ERASE_BLK_EN): " + item_content);
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = item_content;
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"ERASE_BLK_EN",packet_string,"Data");
                                // Erase Sector Size (SECTOR_SIZE)
                                nbits = 7;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                ScanaStudio.dec_item_add_content("Erase Sector Size (SECTOR_SIZE) : " + (sdio_simple.unsigned_words + 1));
                                ScanaStudio.dec_item_add_content("SECTOR_SIZE : " + (sdio_simple.unsigned_words + 1));
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = (sdio_simple.unsigned_words + 1);
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"SECTOR_SIZE",packet_string,"Data");
                                // Write Protect Group Size (WP_GRP_SIZE)
                                nbits = 7;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                ScanaStudio.dec_item_add_content("Write Protect Group Size (WP_GRP_SIZE) : " + (sdio_simple.unsigned_words + 1));
                                ScanaStudio.dec_item_add_content("WP_GRP_SIZE : " + (sdio_simple.unsigned_words + 1));
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = (sdio_simple.unsigned_words + 1);
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"WP_GRP_SIZE",packet_string,"Data");
                                // Write Protect Group Enable (WP_GRP_ENABLE)
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                item_content = WP_GRP_ENABLE(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                ScanaStudio.dec_item_add_content("Write Protect Group Enable (WP_GRP_ENABLE) : " + (sdio_simple.unsigned_words + 1));
                                ScanaStudio.dec_item_add_content("WP_GRP_ENABLE: " + (sdio_simple.unsigned_words + 1));
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = (sdio_simple.unsigned_words + 1);
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"WP_GRP_ENABLE",packet_string,"Data");
                                // Reserved bits
                                nbits = 2;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                reserved_bit(sdio_simple);
                                // Write Speed Factor (R2W_FACTOR)
                                nbits = 3;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                R2W_FACTOR(sdio_simple.unsigned_words, CSD_version, item_display);
                                // Max Write data Block Length (WRITE_BL_LEN)
                                nbits = 4;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                item_content = BL_LEN(sdio_simple.unsigned_words, CSD_version);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                ScanaStudio.dec_item_add_content("Max Write data block length : " + item_content);
                                ScanaStudio.dec_item_add_content("Max block length : " + item_content);
                                ScanaStudio.dec_item_add_content("Max block : " + item_content);
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = item_content;
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"WRITE_BL_LEN",packet_string,"Data");
                                // Partial Block for write allowed (WRITE_BL_PARTIAL)
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (sdio_simple.unsigned_words == 1)
                                {
                                    packet_string = "Smaller block allowed, min 1 byte";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("Partial Block Write is allowed (min block size will be 1 byte) ");
                                    ScanaStudio.dec_item_add_content("Partial Block Write is allowed");
                                }
                                else
                                {
                                    packet_string = "Only 512Bytes Block Allowed";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("Partial Block Write isn't allowed ");
                                }
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"WRITE_BL_PARTIAL",packet_string,types);
                                // Reserved bits
                                nbits = 5;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (sdio_simple.unsigned_words == 0)
                                {
                                    packet_string = "Reserved bits";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("Reserved bits");
                                }
                                else
                                {
                                    packet_string = "Reserved bits should be 0";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("Reserved bits should be 0");
                                    ScanaStudio.dec_item_emphasize_error();
                                }
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"Reserved Bit",packet_string,types);
                                // File format group (FILE_FORMAT_GRP)
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                var FILE_FORMAT_GRP = Number(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                ScanaStudio.dec_item_add_content("File format group (FILE_FORMAT_GRP) : " + sdio_simple.unsigned_words);
                                ScanaStudio.dec_item_add_content("FILE_FORMAT_GRP : " + sdio_simple.unsigned_words);
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = Number(sdio_simple.unsigned_words);
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"FILE_FORMAT_GRP",packet_string,"Data");
                                // Copy Flag (COPY)
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                item_content = COPY(Number(sdio_simple.unsigned_words));
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                ScanaStudio.dec_item_add_content("Copy Flag (COPY) : " + item_content);
                                ScanaStudio.dec_item_add_content("COPY : " + item_content);
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = item_content;
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"COPY",packet_string,"Data");
                                // Permanent Write Protection (PERM_WRITE_PROTECT)
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                item_content = WRITE_PROTECT(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                ScanaStudio.dec_item_add_content("Permanent Write Protection (PERM_WRITE_PROTECT) : " + item_content);
                                ScanaStudio.dec_item_add_content("PERM_WRITE_PROTECT : " + item_content);
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = item_content;
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"PERM_WRITE_PROTECT",packet_string,"Data");
                                // Temporary Write Protection (TMP_WRITE_PROTECT)
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                item_content = WRITE_PROTECT(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                ScanaStudio.dec_item_add_content("Temporary Write Protection (PERM_WRITE_PROTECT) : " + item_content);
                                ScanaStudio.dec_item_add_content("TMP_WRITE_PROTECT : " + item_content);
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = item_content;
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"TMP_WRITE_PROTECT",packet_string,"Data");
                                // File Format (FILE_FORMAT)
                                nbits = 2;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                item_content = FILE_FORMAT(Number(sdio_simple.unsigned_words), FILE_FORMAT_GRP);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                ScanaStudio.dec_item_add_content("File Format (FILE_FORMAT) : " + item_content);
                                ScanaStudio.dec_item_add_content("FILE_FORMAT : " + item_content);
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = item_content;
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"FILE_FORMAT",packet_string,"Data");
                                // Reserved bits
                                nbits = 2;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (sdio_simple.unsigned_words == 0)
                                {
                                    packet_string = "Reserved bits";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("Reserved bits");
                                }
                                else
                                {
                                    packet_string = "Reserved bits should be 0";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("Reserved bits should be 0");
                                    ScanaStudio.dec_item_emphasize_error();
                                }
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"Reserved Bit",packet_string,types);
                            } // end of 1.0 Version

                            else if (sdio_simple.unsigned_words == 1) // If it's the 2.0 Version of the CSD
                            {
                                ScanaStudio.dec_item_add_content("CSD Version 2.0 : High Capacity and Extended Capacity");
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = "CSD Version 2.0";
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"CSD Version",packet_string,"Data");
                                // Product Reserved bits
                                nbits = 6;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                reserved_bit(sdio_simple); // Create Item, display content and samples, create packet_view
                                // Data Read access time-1 (TAAC)
                                nbits = 8;
                                var time_unit_array = [];
                                var time_value_array = [];
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                sdio_value = Number(sdio_simple.unsigned_words);
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (sdio_value == 14)
                                {
                                    packet_string = "TAAC : 1ms"  ;
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("Data Read access time-1 (TAAC) : 1ms");
                                    ScanaStudio.dec_item_add_content("TAAC : " + string_content);
                                }
                                else
                                {
                                    packet_string = "In CSD 2.0 TAAC should be fixed to 1ms"  ;
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("In CSD 2.0 TAAC should be fixed to 1ms");
                                }
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"TAAC",packet_string,types);
                                // Data Read access time-2 in CLK cycles (NSAC*100) (NSAC)
                                nbits = 8;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (Number(sdio_simple.unsigned_words) == 0)
                                {
                                    packet_string = "In CSD 2.0 NSAC isn't used"  ;
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("In CSD 2.0 NSAC isn't used to calculate time-out values");
                                }
                                else
                                {
                                    packet_string = "In CSD 2.0 NSAC should be fixed and not used"  ;
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("In CSD 2.0 NSAC should be fixed and not used");
                                }
                                display_sample(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"NSAC",packet_string,types);
                                // Max data transfer rate (TRAN_SPEED)
                                nbits = 8;
                                var transfer_rate_unit_array = [];
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                for (k=0; k<nbits; k++)
                                {
                                    if (k>0 && k<5)
                                    {
                                        time_value_array.push(item_display[k]);
                                    }
                                    else if (k>4 && k<8)
                                    {
                                        transfer_rate_unit_array.push(item_display[k]);
                                    }
                                }
                                time_value = time_value_switch(bin2dec(time_value_array,4));
                                item_content = transfer_rate_switch(bin2dec(transfer_rate_unit_array,3), time_value);
                                sdio_value = Number(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                switch (sdio_value)
                                {
                                    case 11 :
                                    case 43 :
                                    case 50 :
                                    case 90 :
                                    {
                                        packet_string = "0h" + pad(sdio_value.toString(16),2) + " or " + item_content;
                                        types = "Data";
                                        if (item_content == "Error Reserved bit should be 0")
                                        {
                                            ScanaStudio.dec_item_add_content("Max data transfer rate (TRAN_SPEED) : 0h" + pad(sdio_value.toString(16),2));
                                            ScanaStudio.dec_item_add_content("TRAN_SPEED : 0h" + pad(sdio_simple.unsigned_words.toString(16),2));
                                        }
                                        else
                                        {
                                            ScanaStudio.dec_item_add_content("Max data transfer rate (TRAN_SPEED) : 0h" + pad(sdio_value.toString(16),2) + " or " + item_content);
                                            ScanaStudio.dec_item_add_content("TRAN_SPEED : 0h" + pad(sdio_simple.unsigned_words.toString(16),2) + " or " + item_content);
                                        }
                                        break;
                                    }
                                    default :
                                    {
                                        packet_string = "0h" + pad(sdio_value.toString(16),2) + " is an invalid transfer rate";
                                        types = "Error";
                                        ScanaStudio.dec_item_add_content("0h" + pad(sdio_value.toString(16),2) + " or " + item_content + " is an invalid transfer rate");
                                        ScanaStudio.dec_item_emphasize_error();
                                    }
                                }
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"TRAN_SPEED",packet_string,types);
                                // Card Command Class (CCC)
                                nbits = 12;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                sdio_value = Number(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if ((item_display[1] == 1) && (item_display[3] == 1) && (item_display[4] == 1) && (item_display[5] == 0) && (item_display[6] == 1) && (item_display[7] == 1) && (item_display[8] == 0) && (item_display[9] == 1) && (item_display[11] == 1))
                                {
                                    packet_string = "0b" + pad(sdio_value.toString(2),12);
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("Card Command Class (CCC) : 0b" + pad(sdio_value.toString(2),12));
                                    ScanaStudio.dec_item_add_content("CCC : 0b" + pad(sdio_value.toString(2),12));
                                }
                                else
                                {
                                    packet_string = "0b" + pad(sdio_value.toString(2),12) + " is Invalid Card Command Class";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("0b" + pad(sdio_value.toString(2),12) + " is Invalid Card Command Class");
                                    ScanaStudio.dec_item_emphasize_error();
                                }
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"CCC",packet_string,types);
                                // Max Read data block length (READ_BL_LEN)
                                nbits = 4;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                sdio_value = Number(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (sdio_value == 9)
                                {
                                    packet_string = "Max Read data block length : 512 Bytes";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("Max Read data block length : 512 Bytes");
                                    ScanaStudio.dec_item_add_content("Max block length : 512 Bytes");
                                    ScanaStudio.dec_item_add_content("Max block : 512 Bytes");
                                }
                                else
                                {
                                    packet_string = "READ_BL_LEN is fixed to 512bytes";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("Error in 2.0 Version, READ_BL_LEN is fixed to 512bytes");
                                    ScanaStudio.dec_item_add_content("Error");
                                }
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"READ_BL_LEN",packet_string,types);
                                // Partial Read for read allowed (READ_BL_PARTIAL)
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (Number(sdio_simple.unsigned_words) == 1)
                                {
                                    packet_string = "In 2.0, only unit block is allowed";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("Error, in 2.0, only unit block is allowed");
                                    ScanaStudio.dec_item_add_content("Error");
                                    ScanaStudio.dec_item_emphasize_error();
                                }
                                else
                                {
                                    packet_string = "Only unit block is allowed";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("Only unit block is allowed");
                                }
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"READ_BL_PARTIAL",packet_string,types);
                                // Write Block Misalignement (WRITE_BLK_MISALIGN)
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                sdio_value = Number(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (sdio_value == 1)
                                {
                                    packet_string = "In 2.0, signal out boundaries isn't allowed";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("Error, in 2.0 Version, signals crossing block boundaries never are allowed");
                                    ScanaStudio.dec_item_add_content("Error");
                                    ScanaStudio.dec_item_emphasize_error();
                                }
                                else
                                {
                                    packet_string = "Signal out boundaries is invalid";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("Signals that crossing physical block boundaries is invalid");
                                    ScanaStudio.dec_item_add_content("Signals crossing block boundaries is invalid");
                                }
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"WRITE_BLK_MISALIGN",packet_string,types);
                                // Read Block Misalignement (READ_BLK_MISALIGN)
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                sdio_value = Number(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (sdio_value == 1)
                                {
                                    packet_string = "In 2.0, signal out boundaries isn't allowed";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("Error, in 2.0 Version, signals crossing block boundaries never are allowed");
                                    ScanaStudio.dec_item_add_content("Error");
                                    ScanaStudio.dec_item_emphasize_error();
                                }
                                else
                                {
                                    packet_string = "Signal out boundaries is invalid";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("Signals that crossing physical block boundaries is invalid");
                                    ScanaStudio.dec_item_add_content("Signals crossing block boundaries is invalid");
                                }
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"READ_BLK_MISALIGN",packet_string,types);
                                // DSR implemented (DSR_IMP)
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (sdio_simple.unsigned_words == 1)
                                {
                                    packet_string = "DSR implemented";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("DSR implemented");
                                }
                                else
                                {
                                    packet_string = "DSR not implemented";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("DSR not implemented");
                                }
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"DSR_IMP",packet_string,"Data");
                                // Reserved bits
                                nbits = 6;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                reserved_bit(sdio_simple);
                                // Device Size (C_SIZE)
                                nbits = 22;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                sdio_value = Number(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                ScanaStudio.dec_item_add_content("Device Size (C_SIZE) : 0h" + pad(sdio_value.toString(16),3));
                                ScanaStudio.dec_item_add_content("C_SIZE : 0h" + pad(sdio_value.toString(16),3));
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = "Device Size : 0h" + pad(sdio_value.toString(16),3);
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"C_SIZE",packet_string,"Data");


                                // Reserved bits
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                reserved_bit(sdio_simple);
                                // Erase Single Block Enable (ERASE_BLK_EN)
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                item_content = ERASE_BLK_EN(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (Number(sdio_simple.unsigned_words) == 1)
                                {
                                    packet_string = "Erase units of 512Bytes";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("Erase Single Block Enable (ERASE_BLK_EN) : Erase units of 512Bytes");
                                    ScanaStudio.dec_item_add_content("(ERASE_BLK_EN): Erase units of 512Bytes");
                                }
                                else
                                {
                                    packet_string = "2.0 Version, only erase block of 512Bytes";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("Error, in 2.0 Version, only erase block of 512Bytes");
                                    ScanaStudio.dec_item_emphasize_error();
                                }
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"ERASE_BLK_EN",packet_string,types);
                                // Erase Sector Size (SECTOR_SIZE)
                                nbits = 7;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (Number(sdio_simple.unsigned_words) == 127)
                                {
                                    packet_string = "64KBytes";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("Erase Sector Size (SECTOR_SIZE) : 64KBytes");
                                    ScanaStudio.dec_item_add_content("SECTOR_SIZE : 64KBytes");
                                }
                                else
                                {
                                    packet_string = "Should be fixed to 64KBytes";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("Error, 2.0 Version, SECTOR_SIZE is fixed to 64KBytes");
                                    ScanaStudio.dec_item_add_content("Error");
                                    ScanaStudio.dec_item_emphasize_error();
                                }
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"SECTOR_SIZE",packet_string,types);
                                // Write Protect Group Size (WP_GRP_SIZE)
                                nbits = 7;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (Number(sdio_simple.unsigned_words) == 0)
                                {
                                    packet_string = "SDHC/SDXC don't support WP_GRP";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("SDHC and SDXC don't support WP_GRP");
                                }
                                else
                                {
                                    packet_string = "SDHC/SDXC shouldn't support WP_GRP";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("SDHC and SDXC shouldn't support WP_GRP");
                                    ScanaStudio.dec_item_emphasize_error();
                                }
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"WP_GRP_SIZE",packet_string,types);
                                // Write Protect Group Enable (WP_GRP_ENABLE)
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                item_content = WP_GRP_ENABLE(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (Number(sdio_simple.unsigned_words) == 0)
                                {
                                    packet_string = "SDHC/SDXC don't support WP_GRP";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("SDHC and SDXC don't support WP_GRP");
                                }
                                else
                                {
                                    packet_string = "SDHC/SDXC support WP_GRP";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("SDHC and SDXC shouldn't support WP_GRP");
                                    ScanaStudio.dec_item_emphasize_error();
                                }
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"WP_GRP_ENABLE",packet_string,types);
                                // Reserved bits
                                nbits = 2;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                reserved_bit(sdio_simple);
                                // Write Speed Factor (R2W_FACTOR)
                                nbits = 3;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                R2W_FACTOR(sdio_simple.unsigned_words, CSD_version, item_display);
                                // Max Write data Block Length (WRITE_BL_LEN)
                                nbits = 4;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                item_content = BL_LEN(sdio_simple.unsigned_words, CSD_version);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                ScanaStudio.dec_item_add_content("Max Read data block length : " + item_content);
                                ScanaStudio.dec_item_add_content("Max block length : " + item_content);
                                ScanaStudio.dec_item_add_content("Max block : " + item_content);
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = item_content;
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"WRITE_BL_LEN",packet_string,"Data");
                                // Partial Block for write allowed (WRITE_BL_PARTIAL)
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (sdio_simple.unsigned_words == 1)
                                {
                                    packet_string = "In 2.0, smaller block shouldn't be allowed";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("In 2.0, smaller block shouldn't be allowed");
                                    ScanaStudio.dec_item_add_content("Partial Block Write shouldn't be allowed");
                                }
                                else
                                {
                                    packet_string = "Only 512Bytes Block Allowed";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("Partial Block Write isn't allowed");
                                }
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"WRITE_BL_PARTIAL",packet_string,types);


                                // Reserved bits
                                nbits = 5;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                reserved_bit(sdio_simple);
                                // File format group (FILE_FORMAT_GRP)
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                var FILE_FORMAT_GRP = Number(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (sdio_simple.unsigned_words == 0)
                                {
                                    packet_string = "In 2.0, this field isn't used";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("In 2.0, this field isn't used");
                                }
                                else
                                {
                                    packet_string = "In 2.0, this field shouldn't be used";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("In 2.0, this field shouldn't be used");
                                }
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"FILE_FORMAT_GRP",packet_string,types);
                                // Copy Flag (COPY)
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                item_content = COPY(Number(sdio_simple.unsigned_words));
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                ScanaStudio.dec_item_add_content("Copy Flag (COPY) : " + item_content);
                                ScanaStudio.dec_item_add_content("COPY : " + item_content);
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = item_content;
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"COPY",packet_string,"Data");
                                // Permanent Write Protection (PERM_WRITE_PROTECT)
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                item_content = WRITE_PROTECT(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                ScanaStudio.dec_item_add_content("Permanent Write Protection (PERM_WRITE_PROTECT) : " + item_content);
                                ScanaStudio.dec_item_add_content("PERM_WRITE_PROTECT : " + item_content);
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = item_content;
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"PERM_WRITE_PROTECT",packet_string,"Data");
                                // Temporary Write Protection (TMP_WRITE_PROTECT)
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                item_content = WRITE_PROTECT(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                ScanaStudio.dec_item_add_content("Temporary Write Protection (PERM_WRITE_PROTECT) : " + item_content);
                                ScanaStudio.dec_item_add_content("TMP_WRITE_PROTECT : " + item_content);
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = item_content;
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"TMP_WRITE_PROTECT",packet_string,"Data");
                                // File Format (FILE_FORMAT)
                                nbits = 2;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                item_content = FILE_FORMAT(Number(sdio_simple.unsigned_words), FILE_FORMAT_GRP);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (sdio_simple.unsigned_words == 0)
                                {
                                    packet_string = "In 2.0, this field isn't used";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("In 2.0, this field isn't used");
                                }
                                else
                                {
                                    packet_string = "In 2.0, this field shouldn't be used";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("In 2.0, this field shouldn't be used");
                                }
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"FILE_FORMAT",packet_string,"Data");
                                // Reserved bits
                                nbits = 2;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (sdio_simple.unsigned_words == 0)
                                {
                                    packet_string = "Reserved bits";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("Reserved bits");
                                }
                                else
                                {
                                    packet_string = "Reserved bits should be 0";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("Reserved bits should be 0");
                                    ScanaStudio.dec_item_emphasize_error();
                                }
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"CMD Argument",packet_string,types);
                            } // end of 2.0 Version

                            else if (sdio_simple.unsigned_words == 2) // If it's the 3.0 Version of the CSD
                            {
                                ScanaStudio.dec_item_add_content("CSD Version 3.0 : Ultra Capacity (SDUC)");
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = "CSD Version 3.0";
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"CSD Version",packet_string,"Data");
                                // Product Reserved bits
                                nbits = 6;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                reserved_bit(sdio_simple); // Create Item, display content and samples, create packet_view
                                // Data Read access time-1 (TAAC)
                                nbits = 8;
                                var time_unit_array = [];
                                var time_value_array = [];
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (Number(sdio_simple.unsigned_words) == 0)
                                {
                                    packet_string = "TAAC : 1ms"  ;
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("Data Read access time-1 (TAAC) : 1ms");
                                    ScanaStudio.dec_item_add_content("TAAC : " + string_content);
                                }
                                else
                                {
                                    packet_string = "TAAC should be fixed to 1ms"  ;
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("In CSD 3.0 TAAC should be fixed to 1ms");
                                }
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"TAAC",packet_string,types);
                                // Data Read access time-2 in CLK cycles (NSAC*100) (NSAC)
                                nbits = 8;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (Number(sdio_simple.unsigned_words) == 0)
                                {
                                    packet_string = "In CSD 3.0 NSAC isn't used"  ;
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("In CSD 3.0 NSAC isn't used to calculate time-out values");
                                }
                                else
                                {
                                    packet_string = "NSAC should be fixed and not used"  ;
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("In CSD 3.0 NSAC should be fixed and not used");
                                }
                                display_sample(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"NSAC",packet_string,types);
                                // Max data transfer rate (TRAN_SPEED)
                                nbits = 8;
                                var transfer_rate_unit_array = [];
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                for (k=0; k<nbits; k++)
                                {
                                    if (k>0 && k<5)
                                    {
                                        time_value_array.push(item_display[k]);
                                    }
                                    else if (k>4 && k<8)
                                    {
                                        transfer_rate_unit_array.push(item_display[k]);
                                    }
                                }
                                time_value = time_value_switch(time_value_array);
                                var transfer_rate_unit = bin2dec(transfer_rate_unit_array,4);
                                item_content = transfer_rate_switch(transfer_rate_unit, time_value);
                                sdio_value = Number(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                switch (Number(sdio_simple.unsigned_words))
                                {
                                    case 11 :
                                    case 43 :
                                    case 50 :
                                    case 90 :
                                    {
                                        packet_string = "TRAN_SPEED : 0h" + pad(sdio_value.toString(16),2) + " or " + item_content;
                                        types = "Data";
                                        ScanaStudio.dec_item_add_content("Max data transfer rate (TRAN_SPEED) : 0h" + pad(sdio_value.toString(16),2) + " or " + item_content);
                                        ScanaStudio.dec_item_add_content("TRAN_SPEED : 0h" + pad(sdio_simple.unsigned_words.toString(16),2) + " or " + item_content);
                                        break;
                                    }
                                    default :
                                    {
                                        packet_string = "0h" + pad(sdio_value.toString(16),2) + " is an invalid transfer rate";
                                        types = "Error";
                                        ScanaStudio.dec_item_add_content("0h" + pad(sdio_value.toString(16),2) + " or " + item_content + " is an invalid transfer rate");
                                        ScanaStudio.dec_item_emphasize_error();
                                    }
                                }
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"TRAN_SPEED",packet_string,types);
                                // Card Command Class (CCC)
                                nbits = 12;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                sdio_value = Number(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if ((item_display[1] == 1) && (item_display[3] == 1) && (item_display[4] == 1) && (item_display[5] == 0) && (item_display[6] == 1) && (item_display[7] == 1) && (item_display[8] == 0) && (item_display[9] == 1) && (item_display[11] == 1))
                                {
                                    packet_string = "Card Command Class (CCC) : 0b" + pad(sdio_value.toString(2),12);
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("Card Command Class (CCC) : 0b" + pad(sdio_value.toString(2),12));
                                    ScanaStudio.dec_item_add_content("CCC : 0b" + pad(sdio_value.toString(2),12));
                                }
                                else
                                {
                                    packet_string = "0b" + pad(sdio_value.toString(2),12) + " is an Invalid CCC";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("0b" + pad(sdio_value.toString(2),12) + " is an Invalid Card Command Class");
                                    ScanaStudio.dec_item_emphasize_error();
                                }
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"CCC",packet_string,types);
                                // Max Read data block length (READ_BL_LEN)
                                nbits = 4;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                sdio_value = Number(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (sdio_value == 9)
                                {
                                    packet_string = "Max Read data block length : 512 Bytes";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("Max Read data block length : 512 Bytes");
                                    ScanaStudio.dec_item_add_content("Max block length : 512 Bytes");
                                    ScanaStudio.dec_item_add_content("Max block : 512 Bytes");
                                }
                                else
                                {
                                    packet_string = "READ_BL_LEN is fixed to 512bytes";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("Error in 3.0 Version, READ_BL_LEN is fixed to 512bytes");
                                    ScanaStudio.dec_item_add_content("Error");
                                }
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"READ_BL_LEN",packet_string,types);
                                // Partial Read for read allowed (READ_BL_PARTIAL)
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (Number(sdio_simple.unsigned_words) == 1)
                                {
                                    packet_string = "In 3.0, only unit block is allowed";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("Error, in 3.0, only unit block is allowed");
                                    ScanaStudio.dec_item_add_content("Error");
                                    ScanaStudio.dec_item_emphasize_error();
                                }
                                else
                                {
                                    packet_string = "Only unit block is allowed";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("Only unit block is allowed");
                                }
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"READ_BL_PARTIAL",packet_string,types);
                                // Write Block Misalignement (WRITE_BLK_MISALIGN)
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                sdio_value = Number(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (sdio_value == 1)
                                {
                                    packet_string = "Signal out boundaries isn't allowed";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("Error, in 3.0 Version, signals crossing block boundaries are never allowed");
                                    ScanaStudio.dec_item_add_content("Error");
                                    ScanaStudio.dec_item_emphasize_error();
                                }
                                else
                                {
                                    packet_string = "Signal out boundaries is invalid";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("Signals that crossing physical block boundaries is invalid");
                                    ScanaStudio.dec_item_add_content("Signals crossing block boundaries is invalid");
                                }
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"WRITE_BLK_MISALIGN",packet_string,types);
                                // Read Block Misalignement (READ_BLK_MISALIGN)
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                sdio_value = Number(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (sdio_value == 1)
                                {
                                    packet_string = "In 2.0, signal out boundaries isn't allowed";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("Error, in 3.0 Version, signals crossing block boundaries never are allowed");
                                    ScanaStudio.dec_item_add_content("Error");
                                    ScanaStudio.dec_item_emphasize_error();
                                }
                                else
                                {
                                    packet_string = "Signal out boundaries is invalid";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("Signals that crossing physical block boundaries is invalid");
                                    ScanaStudio.dec_item_add_content("Signals crossing block boundaries is invalid");
                                }
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"READ_BLK_MISALIGN",packet_string,types);
                                // DSR implemented (DSR_IMP)
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (sdio_simple.unsigned_words == 1)
                                {
                                    packet_string = "DSR implemented";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("DSR implemented");
                                }
                                else
                                {
                                    packet_string = "DSR not implemented";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("DSR not implemented");
                                }
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"DSR_IMP",packet_string,"Data");
                                // Device Size (C_SIZE)
                                nbits = 28;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                sdio_value = Number(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                ScanaStudio.dec_item_add_content("Device Size (C_SIZE) : 0h" + pad(sdio_value.toString(16),3));
                                ScanaStudio.dec_item_add_content("C_SIZE : 0h" + pad(sdio_value.toString(16),3));
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = "Device Size : 0h" + pad(sdio_value.toString(16),3);
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"C_SIZE",packet_string,"Data");
                                // Reserved bits
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                reserved_bit(sdio_simple);
                                // Erase Single Block Enable (ERASE_BLK_EN)
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                item_content = ERASE_BLK_EN(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (Number(sdio_simple.unsigned_words) == 1)
                                {
                                    packet_string = "Erase units of 512Bytes";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("Erase Single Block Enable (ERASE_BLK_EN) : Erase units of 512Bytes");
                                    ScanaStudio.dec_item_add_content("(ERASE_BLK_EN): Erase units of 512Bytes");
                                }
                                else
                                {
                                    packet_string = "3.0 Version, only erase block of 512Bytes";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("Error, in 3.0 Version, only erase block of 512Bytes");
                                    ScanaStudio.dec_item_emphasize_error();
                                }
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"ERASE_BLK_EN",packet_string,types);
                                // Erase Sector Size (SECTOR_SIZE)
                                nbits = 7;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (Number(sdio_simple.unsigned_words) == 127)
                                {
                                    packet_string = "64KBytes";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("Erase Sector Size (SECTOR_SIZE) : 64KBytes");
                                    ScanaStudio.dec_item_add_content("SECTOR_SIZE : 64KBytes");
                                }
                                else
                                {
                                    packet_string = "Should be fixed to 64KBytes";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("Error, 3.0 Version, SECTOR_SIZE is fixed to 64KBytes");
                                    ScanaStudio.dec_item_add_content("Error");
                                    ScanaStudio.dec_item_emphasize_error();
                                }
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"SECTOR_SIZE",packet_string,types);
                                // Write Protect Group Size (WP_GRP_SIZE)
                                nbits = 7;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (Number(sdio_simple.unsigned_words) == 0)
                                {
                                    packet_string = "SDHC/SDXC don't support WP_GRP";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("SDHC and SDXC don't support WP_GRP");
                                }
                                else
                                {
                                    packet_string = "SDHC/SDXC shouldn't support WP_GRP";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("SDHC and SDXC shouldn't support WP_GRP");
                                    ScanaStudio.dec_item_emphasize_error();
                                }
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"WP_GRP_SIZE",packet_string,types);
                                // Write Protect Group Enable (WP_GRP_ENABLE)
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                item_content = WP_GRP_ENABLE(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (Number(sdio_simple.unsigned_words) == 0)
                                {
                                    packet_string = "SDHC/SDXC don't support WP_GRP";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("SDHC and SDXC don't support WP_GRP");
                                }
                                else
                                {
                                    packet_string = "SDHC/SDXC support WP_GRP";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("SDHC and SDXC shouldn't support WP_GRP");
                                    ScanaStudio.dec_item_emphasize_error();
                                }
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"WP_GRP_ENABLE",packet_string,types);
                                // Reserved bits
                                nbits = 2;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                reserved_bit(sdio_simple);
                                // Write Speed Factor (R2W_FACTOR)
                                nbits = 3;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                R2W_FACTOR(sdio_simple.unsigned_words, CSD_version, item_display);
                                // Max Write data Block Length (WRITE_BL_LEN)
                                nbits = 4;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                item_content = BL_LEN(sdio_simple.unsigned_words, CSD_version);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                ScanaStudio.dec_item_add_content("Max Read data block length : " + item_content);
                                ScanaStudio.dec_item_add_content("Max block length : " + item_content);
                                ScanaStudio.dec_item_add_content("Max block : " + item_content);
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = item_content;
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"WRITE_BL_LEN",packet_string,"Data");
                                // Partial Block for write allowed (WRITE_BL_PARTIAL)
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (sdio_simple.unsigned_words == 1)
                                {
                                    packet_string = "In 3.0, smaller block shouldn't be allowed";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("In 3.0, smaller block shouldn't be allowed");
                                    ScanaStudio.dec_item_add_content("Partial Block Write shouldn't be allowed");
                                }
                                else
                                {
                                    packet_string = "Only 512Bytes Block Allowed";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("Partial Block Write isn't allowed");
                                }
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"WRITE_BL_PARTIAL",packet_string,types);
                                // Reserved bits
                                nbits = 5;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                reserved_bit(sdio_simple);
                                // File format group (FILE_FORMAT_GRP)
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                var FILE_FORMAT_GRP = Number(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (sdio_simple.unsigned_words == 0)
                                {
                                    packet_string = "In 3.0, this field isn't used";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("In 3.0, this field isn't used");
                                }
                                else
                                {
                                    packet_string = "In 3.0, this field shouldn't be used";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("In 3.0, this field shouldn't be used");
                                }
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"FILE_FORMAT_GRP",packet_string,types);
                                // Copy Flag (COPY)
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                item_content = COPY(Number(sdio_simple.unsigned_words));
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                ScanaStudio.dec_item_add_content("Copy Flag (COPY) : " + item_content);
                                ScanaStudio.dec_item_add_content("COPY : " + item_content);
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = item_content;
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"COPY",packet_string,"Data");
                                // Permanent Write Protection (PERM_WRITE_PROTECT)
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                item_content = WRITE_PROTECT(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                ScanaStudio.dec_item_add_content("Permanent Write Protection (PERM_WRITE_PROTECT) : " + item_content);
                                ScanaStudio.dec_item_add_content("PERM_WRITE_PROTECT : " + item_content);
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = item_content;
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"PERM_WRITE_PROTECT",packet_string,"Data");
                                // Temporary Write Protection (TMP_WRITE_PROTECT)
                                nbits = 1;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                item_content = WRITE_PROTECT(sdio_simple.unsigned_words);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                ScanaStudio.dec_item_add_content("Temporary Write Protection (PERM_WRITE_PROTECT) : " + item_content);
                                ScanaStudio.dec_item_add_content("TMP_WRITE_PROTECT : " + item_content);
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = item_content;
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"TMP_WRITE_PROTECT",packet_string,"Data");
                                // File Format (FILE_FORMAT)
                                nbits = 2;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                item_content = FILE_FORMAT(Number(sdio_simple.unsigned_words), FILE_FORMAT_GRP);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (sdio_simple.unsigned_words == 0)
                                {
                                    packet_string = "In 3.0, this field isn't used";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("In 3.0, this field isn't used");
                                }
                                else
                                {
                                    packet_string = "In 3.0, this field shouldn't be used";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("In 3.0, this field shouldn't be used");
                                }
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = item_content;
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"FILE_FORMAT",packet_string,"Data");
                                // Reserved bits
                                nbits = 2;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                                dec_item_new_v2(ch_cmd,sdio_simple);
                                if (sdio_simple.unsigned_words == 0)
                                {
                                    packet_string = "Reserved bits";
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("Reserved bits");
                                }
                                else
                                {
                                    packet_string = "Reserved bits should be 0";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("Reserved bits should be 0");
                                    ScanaStudio.dec_item_emphasize_error();
                                }
                                display_sample_0_1(sdio_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"Reserved Bit",packet_string,types);
                            } // end of 3.0 Version

                            else  // Reserved Version
                            {
                                ScanaStudio.dec_item_add_content("CSD Reserved Version");
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = "CSD Reserved Version";
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"CSD Version",packet_string,"Data");
                                // Reserved bits
                                start_item = sdio_simple.end_sample;
                                nbits = 118;
                                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_cmd();
                                    state_machine = ENUM_STATE_DATA_START;
                                    break;
                                }
                                for (u=0; u<118; u++)
                                {
                                    crc_calcul.push(sdio_simple.unsigned_words[u]);
                                }
                                var tmp_trs_sample_index;
                                var item_start = ScanaStudio.trs_get_before(ch_clk,start_item + 1);
                                tmp_trs_sample_index = item_start.sample_index;
                                while( (tmp_trs_sample_index == item_start.sample_index) && (ScanaStudio.trs_is_not_last(ch_clk) == true) )
                                {
                                    item_start = ScanaStudio.trs_get_next(ch_clk);
                                }
                                var item_end = ScanaStudio.trs_get_before(ch_clk,sdio_simple.end_sample + 1);
                                tmp_trs_sample_index = item_end.sample_index;
                                while( (tmp_trs_sample_index == item_end.sample_index) && (ScanaStudio.trs_is_not_last(ch_clk) == true) )
                                {
                                    item_end = ScanaStudio.trs_get_next(ch_clk);
                                }
                                ScanaStudio.dec_item_new(ch_cmd,item_start.sample_index + 2,item_end.sample_index - 2);
                                ScanaStudio.dec_item_add_content("Reserved");
                                display_sample(sdio_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_cmd,sdio_simple,"CMD Argument","Reserved","Misc");
                            } // end of Reserved Version
                            // ---------------------------------------------------------------------------------------------------------------------------------//
                        }
                        R_type = "Undefined";
                        state_machine = ENUM_STATE_CRC7;
                        break;
                        }//end case "R2"

                    case "R3" : // Looking for OCR register
                    {
                        // Read OCR Value
                        nbits = 32;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        Voltage_window_32(item_display,ch_cmd,sdio_simple); // Create Dec Item, content, samples, packet_view
                        item_display = [];
                        // Reserved bits (111 1111)
                        nbits = 7;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (Number(sdio_simple.unsigned_words) == 127)
                        {
                            packet_string = R_type + " to CMD" + last_CMD;
                            types = "Preamble";
                            ScanaStudio.dec_item_add_content("Reserved bits (111 1111)");
                            ScanaStudio.dec_item_add_content("Reserved bits");
                        }
                        else
                        {
                            types = "Error";
                            packet_string = "Should be (111 1111)";
                            ScanaStudio.dec_item_add_content("Should be (111 1111)");
                            ScanaStudio.dec_item_emphasize_warning();
                        }
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        R_type = "Undefined";
                        state_machine = ENUM_STATE_CMD_END;
                        break;
                    }//end case "R3"
                    case "R4" :
                    {
                        // Card is ready ?
                        nbits = 1;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (sdio_simple.unsigned_words == 1)
                        {
                            packet_string = "Card Ready to operate";
                            types = "Data";
                            ScanaStudio.dec_item_add_content("Card Ready to operate");
                            ScanaStudio.dec_item_add_content("Ready");
                        }
                        else
                        {
                            packet_string = "Card Not Ready to operate";
                            types = "Data";
                            ScanaStudio.dec_item_add_content("Card Not Ready to operate");
                            ScanaStudio.dec_item_add_content("Card Not Ready");
                            ScanaStudio.dec_item_add_content("Not Ready");
                        }
                        ScanaStudio.dec_item_add_sample_point(sdio_simple.start_sample,"P");
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Ready ?",packet_string,types);

                        // Number of I/O Function supported
                        nbits = 3;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content(sdio_simple.unsigned_words +" I/O Functions supported");
                        ScanaStudio.dec_item_add_content(sdio_simple.unsigned_words +" I/O Functions");
                        ScanaStudio.dec_item_add_content(sdio_simple.unsigned_words +" Functions");
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = sdio_simple.unsigned_words +" I/O Functions supported";
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"I/O Function supported",packet_string,"Data");
                        // Memory Present
                        nbits = 1;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (sdio_simple.unsigned_words == 1)
                        {
                            packet_string = "Card contains SD memory";
                            types = "Data";
                            SDIO_only = false;
                            ScanaStudio.dec_item_add_content("Card contains SD memory");
                            ScanaStudio.dec_item_add_content("SD memory");
                        }
                        else
                        {
                            packet_string = "Card is I/O only";
                            SDIO_only = true;
                            types = "Data";
                            ScanaStudio.dec_item_add_content("Card is I/O only");
                        }
                        ScanaStudio.dec_item_add_sample_point(sdio_simple.start_sample,"P");
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Memory Present",packet_string,types);
                        // Stuff bits
                        nbits = 2;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("Stuff bits (irrelevant)");
                        ScanaStudio.dec_item_add_content("Stuff bits");
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Stuff bit","Stuff Bits","Misc");
                        // Read S18A
                        nbits = 1;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (sdio_simple.unsigned_words == 1)
                        {
                            packet_string = "Switching Accepted";
                            ScanaStudio.dec_item_add_content("Switching Accepted");
                        }
                        else
                        {
                            packet_string = "Switching Not Accepted";
                            ScanaStudio.dec_item_add_content("Switching Not Accepted");
                        }
                        ScanaStudio.dec_item_add_sample_point(sdio_simple.start_sample,"P");
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"S18A",packet_string,"Data");
                        // Read OCR Value
                        nbits = 24;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        RSP_VDD_value = sdio_simple.unsigned_words ;
                        Voltage_window_24(item_display,sdio_simple,ch_cmd); //Display item content and packet view
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        item_display = [];
                        // Reserved Bits
                        nbits = 7;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (sdio_simple.unsigned_words == 127)
                        {
                            packet_string = "Reserved Bits (1111111)";
                            types = "Misc";
                            ScanaStudio.dec_item_add_content("Reserved Bits (1111111)");
                        }
                        else
                        {
                            packet_string = "Should be Reserved Bits (1111111)";
                            types = "Error";
                            ScanaStudio.dec_item_add_content("Should be Reserved Bits (1111111)");
                            ScanaStudio.dec_item_emphasize_warning();
                        }
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Reserved Bit",packet_string,types);
                        R_type = "Undefined";
                        state_machine = ENUM_STATE_CMD_END;
                        break;
                    }//end case "R4"

                    case "R5" : // RSP to CMD52 or CMD53
                    {
                        // Read stuff bits
                        nbits = 16;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("Stuff bits ");
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Stuff Bit","Stuff Bits","Misc");
                        // Read Response Flags Bit
                        str_error = "";
                        nbits = 8;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        var str_array = flag_data_error(item_display);
                        if (str_array[0] == "")
                        {
                            packet_string = "OK, " + str_array[1];
                            types = "Data";
                            ScanaStudio.dec_item_add_content("OK, " + str_array[1]);
                        }
                        else
                        {
                            packet_string = str_array[0] + str_array[1];
                            types = "Error";
                            ScanaStudio.dec_item_add_content(str_array[0] + str_array[1]);
                        }
                        display_sample_0_1(sdio_simple, item_display);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Response Flag Bit",packet_string,types);
                        item_display = [];
                        // Read "Read or Write Data"
                        nbits = 8;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        sdio_value = Number(sdio_simple.unsigned_words);
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        I_O_block_size(R_W, RAW, function_number, register_adress, sdio_value);
                        types = "Data";
                        if (R_W == 1 && RAW == 1)
                        {
                            ScanaStudio.dec_item_add_content("Read the value written by CMD" + CMD + " : " + sdio_simple.unsigned_words);
                        }
                        else if (R_W == 1 && RAW == 0)
                        {
                            ScanaStudio.dec_item_add_content("CMD" + CMD + " Write Data value : " + Write_data);
                        }
                        else if (last_CMD == 53)
                        {
                            if (sdio_value == 0)
                            {
                                types = "Misc";
                                ScanaStudio.dec_item_add_content("Stuff Bits");
                            }
                            else
                            {
                                types = "Error";
                                ScanaStudio.dec_item_add_content("Stuff bits should be 0");
                                ScanaStudio.dec_item_emphasize_warning();
                            }
                        }
                        else if (R_W == 1 && RAW == 1 && function_number == 0 && register_adress == 6 && sdio_value == 8) // Write to the CCCR to reset the I/O Portion of the Card
                        {
                            ScanaStudio.dec_item_add_content("The I/O portion of the Card has been soft reset");
                        }
                        else
                        {
                            ScanaStudio.dec_item_add_content("Actual value of adress 0x" + pad(register_adress.toString(16),5) + " from function " + function_number + " is : " + sdio_simple.unsigned_words);
                        }
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Read/Write Data","Look Item","Data");
                        // Reset all variables values
                        R_W = -1;
                        RAW = -1;
                        Write_data = -1;
                        item_display = [];
                        R_type = "Undefined";
                        state_machine = ENUM_STATE_CRC7;
                        break;
                    }//end case "R5"

                    case "R6" : // Looking for new RCA and Card Status
                    {
                        // Read new RCA
                        nbits = 16;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        sdio_value = Number(sdio_simple.unsigned_words);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("RCA (Card Adress) : 0x"+ pad(sdio_value.toString(16),4));
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "Card Adress : 0x"+ pad(sdio_value.toString(16),4);
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"RCA",packet_string,"Data");
                        // Read status bits
                        nbits = 16;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        str_error = card_status_error_16(item_display);
                        item_display = [];
                        R_type = "Undefined";
                        state_machine = ENUM_STATE_CRC7;
                        break;
                    }//end case "R6"

                    case "R7" :
                    {
                        // Reserved bits
                        nbits = 18;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (sdio_simple.unsigned_words == 0)
                        {
                            packet_string = "Reserved (00000h)";
                            types = "Misc";
                            ScanaStudio.dec_item_add_content("Reserved (00000h)");
                        }
                        else
                        {
                            packet_string = "Should be 00000h";
                            types = "Error";
                            ScanaStudio.dec_item_add_content("Should be 00000h");
                            ScanaStudio.dec_item_emphasize_error();
                        }
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Reserved bit",packet_string,types);
                        // Read PCIe 1.2V Support
                        nbits = 1;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        sdio_value = Number(sdio_simple.unsigned_words);
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (sdio_value == 0)
                        {
                            packet_string = "Not Supported"
                            ScanaStudio.dec_item_add_content("PCIe 1.2V Support : Not Supported");
                        }
                        else
                        {
                            packet_string = "Supported";
                            ScanaStudio.dec_item_add_content("PCIe 1.2V Support : Supported");
                        }
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"PCIe 1.2V Support",packet_string,"Data");
                        // Read PCIe acceptance
                        nbits = 1;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        sdio_value = Number(sdio_simple.unsigned_words);
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (sdio_value == 0)
                        {
                            packet_string = "Not Accepted"
                            ScanaStudio.dec_item_add_content("PCIe 1.2V Support : Not Accepted");
                        }
                        else
                        {
                            packet_string = "Accepted";
                            ScanaStudio.dec_item_add_content("PCIe 1.2V Support : Accepted");
                        }
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"PCIe acceptance",packet_string,"Data");
                        // Voltage accepted
                        nbits = 4;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (Number(sdio_simple.unsigned_words) == CMD8_Voltage)
                        {
                            packet_string = "Voltage accepted";
                            types = "Data";
                            ScanaStudio.dec_item_add_content("Voltage accepted");
                        }
                        else
                        {
                            packet_string = "Voltage unaccepted";
                            types = "Data";
                            ScanaStudio.dec_item_add_content("Voltage unaccepted");
                            ScanaStudio.dec_item_emphasize_warning();
                        }
                        CMD8_Voltage = -1; //reset CMD8_Voltage value
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"HSV",packet_string,types);
                        // Echo-back of check pattern
                        nbits = 8;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        dec_item_new_v2(ch_cmd,sdio_simple);
                        if (Number(sdio_simple.unsigned_words) == CMD8_check_pattern)
                        {
                            packet_string = "Check Pattern OK";
                            types = "Check";
                            ScanaStudio.dec_item_add_content("Check Pattern OK");
                        }
                        else
                        {
                            packet_string = "Check Pattern not OK";
                            types = "Error";
                            ScanaStudio.dec_item_add_content("Check Pattern not OK");
                            ScanaStudio.dec_item_emphasize_warning();
                        }
                        CMD8_check_pattern = -1; //reset CMD8_check_pattern value
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Check Pattern",packet_string,types);
                        R_type = "Undefined";
                        state_machine = ENUM_STATE_CRC7;
                        break;
                    }//end case "R7"

                    case "Undefined" :
                    {
                        // Unknown
                        nbits = 32;
                        sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                        var test = dec_item_new_v2(ch_cmd,sdio_simple);
                        ScanaStudio.dec_item_add_content("Error, CMD" + last_CMD + " shouldn't have RSP");
                        ScanaStudio.dec_item_emphasize_error();
                        display_sample(sdio_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "Error, CMD" + last_CMD + " shouldn't have RSP";
                        packet_view_add_packet_v2(ch_cmd,sdio_simple,"Check Pattern",packet_string ,"Error");
                        state_machine = ENUM_STATE_CRC7;
                        break;
                    }//end case "Undefined"
                }//end switch(R_type)
            break;
            }//end ENUM_STATE_RSP_ARGUMENT


            case ENUM_STATE_CRC7 : // Lecture du CRC-7
            {
                nbits = 7;
                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                if (last_trans == true) //if sync_decode overpassed the last sample
                {
                    go_to_last_trans_cmd();
                    state_machine = ENUM_STATE_DATA_START;
                    break;
                }
                // Display 0/1 on the dec.item
                crc_calculated = crc7(crc_calcul);
                item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                dec_item_new_v2(ch_cmd,sdio_simple);
                if (crc_calculated == Number(sdio_simple.unsigned_words))
                {
                    packet_string = "CRC-7 OK";
                    types = "Check";
                    ScanaStudio.dec_item_add_content("CRC-7 OK");
                    ScanaStudio.dec_item_add_content("OK");
                }
                else
                {
                    packet_string = "CRC-7 NOT OK";
                    types = "Error";
                    ScanaStudio.dec_item_add_content("CRC-7 NOT OK");
                    ScanaStudio.dec_item_add_content("NOT OK");
                    ScanaStudio.dec_item_emphasize_warning();
                }
                display_sample_0_1(sdio_simple, item_display);
                ScanaStudio.dec_item_end();
                //Packet View
                packet_view_add_packet_v2(ch_cmd,sdio_simple,"CRC",packet_string,types);
                item_display = [];
                state_machine = ENUM_STATE_CMD_END;
                break;
            }//end ENUM_STATE_CRC7

            case ENUM_STATE_CRC16 : // Lecture du CRC-16
            {
                nbits = 16;
                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample +1,nbits);
                crc_calculated = crc16_1bit(crc_calcul, speed_mode);
                if (speed_mode == 1)
                {
                    for (c=0; c<data_channels.length; c++)
                    {
                        item_display = crc_pre_calcul(sdio_simple.unsigned_words[c],nbits,crc_calcul);
                        dec_item_new_v2(data_channels[c], sdio_simple);
                        if (crc_calculated[c] == Number(sdio_simple.unsigned_words[c]))
                        {
                            packet_string = "CRC-16 OK";
                            ScanaStudio.dec_item_add_content("CRC-16 OK");
                            ScanaStudio.dec_item_add_content("OK");
                            ScanaStudio.packet_view_add_packet(false,data_channels[c],sdio_simple.start_sample,sdio_simple.start_sample,"CRC",packet_string,ScanaStudio.PacketColors.Check.Title,ScanaStudio.PacketColors.Check.Content);
                        }
                        else
                        {
                            packet_string = "CRC-16 NOT OK";
                            ScanaStudio.dec_item_add_content("CRC-16 NOT OK");
                            ScanaStudio.dec_item_add_content("NOT OK");
                            ScanaStudio.dec_item_emphasize_warning();
                            ScanaStudio.packet_view_add_packet(false,data_channels[c],sdio_simple.start_sample,sdio_simple.start_sample,"CRC",packet_string,ScanaStudio.PacketColors.Error.Title,ScanaStudio.PacketColors.Error.Content);
                        }
                        // Display 0/1 on the dec.item
                        display_sample_0_1(sdio_simple, item_display);
                        ScanaStudio.dec_item_end();
                    }
                }
                else
                {
                    item_display = crc_pre_calcul(sdio_simple.unsigned_words,nbits,crc_calcul);
                    dec_item_new_v2(ch_dat0, sdio_simple);
                    if (crc_calculated == Number(sdio_simple.unsigned_words))
                    {
                        packet_string = "CRC-16 OK";
                        ScanaStudio.dec_item_add_content("CRC-16 OK");
                        ScanaStudio.dec_item_add_content("OK");
                        ScanaStudio.packet_view_add_packet(false,ch_dat0,sdio_simple.start_sample,sdio_simple.start_sample,"CRC",packet_string,ScanaStudio.PacketColors.Check.Title,ScanaStudio.PacketColors.Check.Content);
                    }
                    else
                    {
                        packet_string = "CRC-16 NOT OK";
                        ScanaStudio.dec_item_add_content("CRC-16 NOT OK");
                        ScanaStudio.dec_item_add_content("NOT OK");
                        ScanaStudio.dec_item_emphasize_warning();
                        ScanaStudio.packet_view_add_packet(false,data_channels,sdio_simple.start_sample,sdio_simple.start_sample,"CRC",packet_string,ScanaStudio.PacketColors.Error.Title,ScanaStudio.PacketColors.Error.Content);
                    }
                    // Display 0/1 on the dec.item
                    display_sample_0_1(sdio_simple, item_display);
                    ScanaStudio.dec_item_end();
                }
                item_display = [];
                state_machine = ENUM_STATE_DATA_END;
                break;
            }//end ENUM_STATE_CRC16

            case ENUM_STATE_CMD_END :
            {
                nbits = 1;
                sdio_simple = sync_decode_v2(cmd_channel,sdio_simple.end_sample +1,nbits);
                if (last_trans == true) //if sync_decode overpassed the last sample
                {
                    go_to_last_trans_cmd();
                    state_machine = ENUM_STATE_DATA_START;
                    break;
                }
                // Reset crc_array
                crc_calcul = [];
                item_display = [];
                crc_pre_display = [];
                dec_item_new_v2(ch_cmd, sdio_simple);
                if (sdio_simple.unsigned_words == 1)
                {
                    packet_string = "End CMD";
                    types = "Wrap";
                    ScanaStudio.dec_item_add_content("End");
                    ScanaStudio.dec_item_add_content("E");
                }
                else
                {
                    packet_string = "End CMD";
                    types = "Error";
                    ScanaStudio.dec_item_add_content("End");
                    ScanaStudio.dec_item_add_content("E");
                    ScanaStudio.dec_item_emphasize_error();
                }
                ScanaStudio.dec_item_add_sample_point(sdio_simple.start_sample,"P");
                ScanaStudio.dec_item_end();
                //Packet View
                packet_view_add_packet_v2(ch_cmd,sdio_simple,"End",packet_string,types);
                while ((trs_cmd.sample_index < sdio_simple.end_sample))
                {
                    trs_cmd = ScanaStudio.trs_get_next(ch_cmd);
                    if (!ScanaStudio.trs_is_not_last(ch_cmd))
                    {
                        break;
                    }
                }
                trs_dat0 = ScanaStudio.trs_get_before(ch_dat0,sdio_simple.end_sample);
                tmp_trs_sample_index = trs_dat0.sample_index;
                while(tmp_trs_sample_index == trs_dat0.sample_index)
                {
                    trs_dat0 = ScanaStudio.trs_get_next(ch_dat0);
                    if (!ScanaStudio.trs_is_not_last(ch_dat0))
                    {
                        break;
                    }
                }
                if ((last_CMD == 25 || last_CMD == 18 || last_CMD == 58 || last_CMD == 59) && R_type == "Undefined" && SDIO_only == false)
                {
                        stop_cmd = sync_decode_v2(cmd_channel,trs_cmd.sample_index +1,8);
                        /*while (stop_cmd.unsigned_words != 76)
                        {
                            trs_cmd = ScanaStudio.trs_get_next(ch_cmd);
                            stop_cmd = sync_decode_v2(cmd_channel,trs_cmd.sample_index +1,8);
                            if (!ScanaStudio.trs_is_not_last(ch_cmd))
                            {
                                break;
                            }
                        }*/
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_data();
                            // state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        stop_cmd = sync_decode_v2(cmd_channel,stop_cmd.end_sample +1,40);
                        end_data_sample_index = stop_cmd.end_sample;
                }
                if (last_CMD == 53 && R_type == "Undefined")
                {
                    stop_cmd = sync_decode_v2(cmd_channel,trs_cmd.sample_index +1,8);
                    /*while (stop_cmd.unsigned_words != 116)
                    {
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_cmd();
                            state_machine = ENUM_STATE_DATA_START;
                            break;
                        }
                        trs_cmd = ScanaStudio.trs_get_next(ch_cmd);
                        stop_cmd = sync_decode_v2(cmd_channel,trs_cmd.sample_index +1,8);
                    }*/
                    stop_cmd = sync_decode_v2(cmd_channel,stop_cmd.end_sample +1,40);
                    end_data_sample_index = stop_cmd.end_sample;
                }
                if ((data_transfer == true) && (R_type == "Undefined"))
                {
                    state_machine = ENUM_STATE_DATA_START;
                }
                else
                {
                    state_machine = ENUM_STATE_CMD_START;
                }
                break;
            }//end ENUM_STATE_CMD_END

            case ENUM_STATE_DATA_END :
            {
                Block_counter ++; // Update the Block_counter value
                nbits = 1;
                sdio_simple = sync_decode_v3(data_channels,sdio_simple.end_sample +1,nbits);
                if (last_trans == true) //if sync_decode overpassed the last sample
                {
                    go_to_last_trans_data();
                    state_machine = ENUM_STATE_DATA_START;
                    break;
                }
                // Reset crc_array
                crc_calcul = [];
                item_display = [];
                crc_pre_display = [];
                if (speed_mode == 0)
                {
                    dec_item_new_v2(ch_dat0, sdio_simple);
                    if (sdio_simple.unsigned_words == 1)
                    {
                        packet_string = "End DATA";
                        types = "Wrap";
                        ScanaStudio.dec_item_add_content("End");
                        ScanaStudio.dec_item_add_content("E");
                    }
                    else
                    {
                        packet_string = "End DATA";
                        types = "Error";
                        ScanaStudio.dec_item_add_content("End");
                        ScanaStudio.dec_item_add_content("E");
                        ScanaStudio.dec_item_emphasize_error();
                    }
                    ScanaStudio.dec_item_add_sample_point(sdio_simple.start_sample,"P");
                    ScanaStudio.dec_item_end();
                    //Packet View
                    ScanaStudio.packet_view_add_packet(false,ch_dat0,sdio_simple.start_sample,sdio_simple.start_sample,"End","Data",ScanaStudio.PacketColors.Wrap.Title,ScanaStudio.PacketColors.Wrap.Content);
                    // packet_view_add_packet_v2(ch_cmd,sdio_simple,"End",packet_string,types);
                    while ((trs_dat0.sample_index < sdio_simple.end_sample))
                    {
                      if (!ScanaStudio.trs_is_not_last(ch_dat0))
                      {
                        break;
                      }
                        trs_dat0 = ScanaStudio.trs_get_next(ch_dat0);
                    }
                }
                else
                {
                    for (a=0; a<data_channels.length; a++)
                    {
                        var start_and_stop_item = dec_item_new_v2(data_channels[a], sdio_simple);
                        if (sdio_simple.unsigned_words[a] == 1)
                        {
                            packet_string = "End DATA";
                            types = "Wrap";
                            ScanaStudio.dec_item_add_content("End");
                            ScanaStudio.dec_item_add_content("E");
                        }
                        else
                        {
                            packet_string = "End DATA";
                            types = "Error";
                            ScanaStudio.dec_item_add_content("End");
                            ScanaStudio.dec_item_add_content("E");
                            ScanaStudio.dec_item_emphasize_error();
                        }
                        ScanaStudio.dec_item_add_sample_point(sdio_simple.start_sample,"P");
                        ScanaStudio.dec_item_end();
                        //Packet View
                        ScanaStudio.packet_view_add_packet(false,data_channels[a],sdio_simple.start_sample,sdio_simple.end_sample,"End","End Data",ScanaStudio.PacketColors.Wrap.Title,ScanaStudio.PacketColors.Wrap.Content);
                        while ((trs_data[a].sample_index < sdio_simple.end_sample))
                        {
                            if (!ScanaStudio.trs_is_not_last(data_channels[a]))
                            {
                                break;
                            }
                            trs_data[a] = ScanaStudio.trs_get_next(data_channels[a]);
                        }
                    }
                    // Display the busy signal on the DAT0 line
                    trs_dat0 = ScanaStudio.trs_get_before(ch_dat0,(trs_data[2].sample_index + 1));
                    /*var busy = (trs_data[1].sample_index - trs_data[0].sample_index) > 2; //
                    if (busy)
                    {
                        tmp_trs_sample_index = trs_dat0.sample_index;
                        while( (tmp_trs_sample_index == trs_dat0.sample_index) && (ScanaStudio.trs_is_not_last(ch_dat0) == true) )
                        {
                            trs_dat0 = ScanaStudio.trs_get_previous(ch_dat0);
                        }
                        tmp_trs_sample_index = trs_dat0.sample_index;
                        while( (tmp_trs_sample_index == trs_dat0.sample_index) && (ScanaStudio.trs_is_not_last(ch_dat0) == true) )
                        {
                            trs_dat0 = ScanaStudio.trs_get_next(ch_dat0);
                        }
                        trs_cmd = ScanaStudio.trs_get_before(ch_cmd,sdio_simple.end_sample);
                        tmp_trs_sample_index = trs_cmd.sample_index;
                        while( (tmp_trs_sample_index == trs_cmd.sample_index) && (ScanaStudio.trs_is_not_last(ch_cmd) == true) )
                        {
                            trs_cmd = ScanaStudio.trs_get_next(ch_cmd);
                        }
                        if ((ScanaStudio.trs_is_not_last(data_channels[2])) && (trs_dat0.sample_index > start_and_stop_item[1]) && (trs_dat0.sample_index < trs_cmd.sample_index)) // if we read enough data block
                        {
                            test = ScanaStudio.dec_item_new(ch_dat0,start_and_stop_item[1],trs_dat0.sample_index);
                            ScanaStudio.dec_item_add_content("Busy Signal");
                            ScanaStudio.dec_item_end();
                        }
                    }*/
                }
                if ((last_CMD != 25) && (last_CMD != 18) && (last_CMD != 58) && (last_CMD != 59))
                {
                    trs_cmd = ScanaStudio.trs_get_before(ch_cmd,sdio_simple.end_sample);
                }
                if (trs_dat0.sample_index < end_data_sample_index)
                {
                    if (Block_count == -1) // Infinite Block until CMD 12
                    {
                        state_machine = ENUM_STATE_DATA_START;
                    }
                    else if (Block_counter >= Block_count) // if we read enough data block
                    {
                        state_machine = ENUM_STATE_CMD_START;
                    }
                    else
                    {
                        state_machine = ENUM_STATE_DATA_START;
                    }
                }
                else
                {
                    state_machine = ENUM_STATE_CMD_START;
                }
                break;
            }//end ENUM_STATE_DATA_END

            case ENUM_STATE_UNDEFINED :
            {
                trs_cmd = ScanaStudio.trs_get_next(ch_cmd);
                break;
            }//end ENUM_STATE_UNDEFINED
        }//end switch(state_machine)
  }//end while(ScanaStudio.abort_is_requested() == false)
  if (show_pdf_on_console == true)
  {
      // ScanaStudio.console_info_msg("https://www.sdcard.org/downloads/pls/index.html (Specification Layer 7.1)");
  }
}//end on_decode_signals


//Trigger sequence GUI
function on_draw_gui_trigger()
{

  ScanaStudio.gui_add_new_selectable_containers_group("trig_alternative","Select trigger alternative");
    ScanaStudio.gui_add_new_container("Trigger on any CMD",true);
      ScanaStudio.gui_add_info_label("Trigger on any SDIO CMD, regardless of its value.");
    ScanaStudio.gui_end_container();
    ScanaStudio.gui_add_new_container("Trigger on CMD value",false);
      ScanaStudio.gui_add_text_input("trig_cmd","Trigger CMD value","0x0");
      ScanaStudio.gui_add_info_label("Choose a CMD between 0 and 63." +
      "The field can accept decimal value (52), "
          + "hex value (0x05) or ASCII character ('A')."
        );
    ScanaStudio.gui_end_container();
    ScanaStudio.gui_add_new_container("Trigger on any data word",false);
      ScanaStudio.gui_add_info_label("Trigger on any data word, regardless of its value.");
    ScanaStudio.gui_end_container();
    ScanaStudio.gui_add_new_container("Trigger on data word value",false);
      ScanaStudio.gui_add_text_input("trig_byte","Trigger word value","0x0");
      ScanaStudio.gui_add_info_label("The field can accept decimal value (52), "
          + "hex value (0x05) or ASCII character ('A')."
        );
  ScanaStudio.gui_end_selectable_containers_group();
}

function on_eval_gui_trigger()
{
    if (ScanaStudio.gui_get_value("trig_cmd") > 63)
    {
      return "Invalid trigger command, please select a number between 0 and 63";
    }
    if (    (ScanaStudio.gui_get_value("trig_byte").search("'") >= 0)
        &&  (ScanaStudio.gui_get_value("trig_byte").length  > 3))
    {
      return "Invalid trigger word, please type only one character, e.g. 'A'";
    }
    if (ScanaStudio.gui_get_value("trig_byte").search("\"") >= 0)
    {
      return "Trigger word field contains invalid characters";
    }

    return "";
}

function on_build_trigger()
{
  var trig_cmd = Number(ScanaStudio.gui_get_value("trig_cmd"));
  var trig_byte = ScanaStudio.gui_get_value("trig_byte");
  var trig_alternative = Number(ScanaStudio.gui_get_value("trig_alternative"));
  var bit_array = [];
  // Reload Decoder GUI values (global variables)
  reload_dec_gui_values();


  if (speed_mode == 1) // 4 DAT_channel
  {
      var sdio_step = {cmd: "X", clk: "X", dat0: "X", dat1: "X", dat2: "X", dat3: "X"};
  }
  else
  {
      var sdio_step = {cmd: "X", clk: "X", dat0: "X"};
  }
  var sdio_trig_steps = [];

  sdio_trig_steps.length = 0;


  if (trig_alternative == 0) //Trigger on any CMD
  {
      if (speed_mode == 1)
      {
          sdio_step.cmd = "F";
          sdio_step.clk = "X";
          sdio_step.dat0 = "X";
          sdio_step.dat3 = "X";
          sdio_step.dat2 = "X";
          sdio_step.dat1 = "X";
          sdio_trig_steps.push(new SdioTrigStep(sdio_step.cmd, sdio_step.clk, sdio_step.dat0, sdio_step.dat1, sdio_step.dat2, sdio_step.dat3));
      }
      else
      {
          sdio_step.cmd = "F";
          sdio_step.clk = "X";
          sdio_step.dat0 = "X";
          sdio_trig_steps.push(new SdioTrigStep(sdio_step.cmd, sdio_step.clk, sdio_step.dat0));
      }
  }
  else if (trig_alternative == 1) //Trigger on CMD value
  {
      trig_cmd = Number(trig_cmd);
      if (speed_mode == 1)
      {
          for (n=5; n>=0; n--)
          {
              sdio_step.cmd = (trig_cmd>>n)&0x1.toString();
              sdio_step.clk = "R";
              sdio_step.dat0 = "X";
              sdio_step.dat3 = "X";
              sdio_step.dat2 = "X";
              sdio_step.dat1 = "X";
              sdio_trig_steps.push(new SdioTrigStep(sdio_step.cmd, sdio_step.clk, sdio_step.dat0, sdio_step.dat1, sdio_step.dat2, sdio_step.dat3));
          }
      }
      else
      {
          sdio_step.cmd = (trig_cmd>>n)&0x1.toString();
          sdio_step.clk = "R";
          sdio_step.dat0 = "X";
          sdio_trig_steps.push(new SdioTrigStep(sdio_step.cmd, sdio_step.clk, sdio_step.dat0));
      }
  }
  else if (trig_alternative == 2) // Trigger on any word
  {
      if (speed_mode == 1)
      {
              sdio_step.dat3 = "X";
              sdio_step.dat2 = "X";
              sdio_step.dat1 = "X";
              sdio_step.dat0 = "F";
              sdio_step.clk = "X";
              sdio_step.cmd = "X";
              sdio_trig_steps.push(new SdioTrigStep(sdio_step.cmd, sdio_step.clk, sdio_step.dat0, sdio_step.dat1, sdio_step.dat2, sdio_step.dat3));
      }
      else
      {
              sdio_step.dat0 = "F";
              sdio_step.clk = "X";
              sdio_step.cmd = "X";
              sdio_step.dat3 = "X";
              sdio_step.dat2 = "X";
              sdio_step.dat1 = "X";
              sdio_trig_steps.push(new SdioTrigStep(sdio_step.cmd, sdio_step.clk, sdio_step.dat0, sdio_step.dat1, sdio_step.dat2, sdio_step.dat3));
      }
  }
  else if (trig_alternative == 3)// Trigger on data Word
  {
      if (trig_byte.charAt(0) == "'")
    	{
    		trig_byte = trig_byte.charCodeAt(1);
    	}
    	else
    	{
    		trig_byte = Number(trig_byte);
    	}
      if (speed_mode == 1)
      {
          for (n=1; n>=0; n--)
          {
              sdio_step.dat3 = (trig_byte>>(4*n+3))&0x1.toString();
              sdio_step.dat2 = (trig_byte>>(4*n+2))&0x1.toString();
              sdio_step.dat1 = (trig_byte>>(4*n+1))&0x1.toString();
              sdio_step.dat0 = (trig_byte>>(4*n))&0x1.toString();
              sdio_step.clk = "R";
              sdio_step.cmd = "X";
              sdio_trig_steps.push(new SdioTrigStep(sdio_step.cmd, sdio_step.clk, sdio_step.dat0, sdio_step.dat1, sdio_step.dat2, sdio_step.dat3));
          }
      }
      else
      {
          for (n=7; n>=0; n--)
          {
              sdio_step.dat0 = (trig_byte>>n)&0x1.toString();
              sdio_step.clk = "R";
              sdio_step.cmd = "X";
              sdio_step.dat3 = "X";
              sdio_step.dat2 = "X";
              sdio_step.dat1 = "X";
              sdio_trig_steps.push(new SdioTrigStep(sdio_step.cmd, sdio_step.clk, sdio_step.dat0, sdio_step.dat1, sdio_step.dat2, sdio_step.dat3));
          }
      }
  }
  for (i = 0; i < sdio_trig_steps.length; i++)
  {
      ScanaStudio.flexitrig_append(trig_build_step(sdio_trig_steps[i]), -1, -1);
  }
  ScanaStudio.flexitrig_print_steps();
    // ....
}


function SdioTrigStep (cmd, clk, dat0)
{
	this.cmd = cmd;
	this.clk  = clk;
    this.dat0 = dat0
};


function SdioTrigStep (cmd, clk, dat0, dat1, dat2, dat3)
{
	this.cmd = cmd;
	this.clk  = clk;
    this.dat0 = dat0;
	this.dat1   = dat1;
    this.dat2 = dat2;
	this.dat3   = dat3;
};

function trig_build_step (step_desc)
{
	var i;
	var step = "";

	for (i = 0; i < ScanaStudio.get_device_channels_count(); i++)
	{
        if (speed_mode == 1)
        {
            switch (i)
            {
                case ch_cmd: step = step_desc.cmd + step; break;
                case ch_clk: step = step_desc.clk + step; break;
                case ch_dat0: step = step_desc.dat0 + step; break;
                case ch_dat1: step = step_desc.dat1 + step; break;
                case ch_dat2: step = step_desc.dat2 + step; break;
                case ch_dat3: step = step_desc.dat3 + step; break;
                default:      step = "X" + step; break;
            }
        }
        else
        {
            switch (i)
            {
            case ch_cmd: step = step_desc.cmd + step; break;
            case ch_clk: step = step_desc.clk + step; break;
            case ch_dat0: step = step_desc.dat0 + step; break;
            default:      step = "X" + step; break;
            }
        }
	}
	return step;
}

//Function called to generate demo signals (when no physical device is attached)
function on_build_demo_signals()
{
  //Use the function below to get the number of samples to be built
  var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
  var sdio_builder = ScanaStudio.BuilderObject;
  var sample_rate = ScanaStudio.builder_get_sample_rate();
  var ch_cmd = ScanaStudio.gui_get_value("ch_cmd");
  var ch_clk = ScanaStudio.gui_get_value("ch_clk");
  var ch_dat0 = ScanaStudio.gui_get_value("ch_dat0");
  var ddr_mode = ScanaStudio.gui_get_value("DDR");
  if (ScanaStudio.get_device_channels_count() > 4)
  {
      var dat_mode = ScanaStudio.gui_get_value("quad_DAT");
      var ch_dat1 = ScanaStudio.gui_get_value("ch_dat1");
      var ch_dat2 = ScanaStudio.gui_get_value("ch_dat2");
      var ch_dat3 = ScanaStudio.gui_get_value("ch_dat3");
  }
  else
  {
      var dat_mode = 0;
  }
  var clk_channel = ch_clk;
  var sdio_f = sample_rate/100; //Valeur arbitraire de la frequence de l'horloge (1/100eme de la frequence d'echantillonnage)
  var sample_per_clock = sample_rate/sdio_f;
  var silence_period = samples_to_build/300; //1/100eme du signal total


  sdio_builder.config(ch_cmd,ch_clk,ch_dat0,ch_dat1,ch_dat2,ch_dat3,sdio_f,ddr_mode, dat_mode);

  var lvl = 1;
  var value;
  var data_transfer_2 = false;
  CMD_mode = 0;
  var crc_calcul = [];
  var cmd_number;
  var RCA = 7;
  sdio_builder.put_silence(samples_to_build/100);
  ScanaStudio.builder_add_samples(ch_clk,1,1); //



  // Reset the I/O Portion of the Card
  sdio_builder.put_start_cmd(1, crc_calcul);
  sdio_builder.put_cmd_number(52, crc_calcul);
  sdio_builder.put_cmd_bits(1, 1, crc_calcul); // R/W (Write)
  sdio_builder.put_cmd_bits(0, 3, crc_calcul); // function number
  sdio_builder.put_cmd_bits(1, 1, crc_calcul); // RAW
  sdio_builder.put_cmd_bits(0, 1, crc_calcul); // Stuff
  sdio_builder.put_cmd_bits(6, 17, crc_calcul); // Register adress
  sdio_builder.put_cmd_bits(0, 1, crc_calcul); // Stuff
  sdio_builder.put_cmd_bits(8, 8, crc_calcul); // Write (Reset the I/O portion)
  sdio_builder.put_crc7(crc_calcul);
  sdio_builder.put_end_cmd();
  sdio_builder.put_silence(10*sample_per_clock);
  crc_calcul = [];

  sdio_builder.put_start_cmd(0, crc_calcul);
  sdio_builder.put_cmd_number(52, crc_calcul);
  sdio_builder.put_cmd_bits(0, 16, crc_calcul); //Stuff
  sdio_builder.put_cmd_bits(0, 8, crc_calcul); // Respond no error to the write cmd and current state : dis
  sdio_builder.put_cmd_bits(8, 8, crc_calcul); // I/O is reset
  sdio_builder.put_crc7(crc_calcul);
  sdio_builder.put_end_cmd();
  sdio_builder.put_silence(10*sample_per_clock);
  crc_calcul = [];

  // CMD5 (I_O_SEND_OP_COND)
  sdio_builder.put_start_cmd(1, crc_calcul);
  sdio_builder.put_cmd_number(5, crc_calcul);
  sdio_builder.put_cmd_bits(0, 7, crc_calcul); // Stuff
  sdio_builder.put_cmd_bits(0, 1, crc_calcul); // Arg 0 after power on or cmd 52 I/O reset
  sdio_builder.put_cmd_bits(0, 9, crc_calcul); // Arg 0 after power on or cmd 52 I/O reset
  sdio_builder.put_cmd_bits(0, 15, crc_calcul); // Arg 0 after power on or cmd 52 I/O reset
  sdio_builder.put_crc7(crc_calcul);
  sdio_builder.put_end_cmd();
  sdio_builder.put_silence(10*sample_per_clock);
  crc_calcul = [];

  // R4 to CMD5
  sdio_builder.put_start_cmd(0, crc_calcul);
  sdio_builder.put_cmd_number(63, crc_calcul);
  sdio_builder.put_cmd_bits(1, 1, crc_calcul); // Ready to operate
  sdio_builder.put_cmd_bits(7, 3, crc_calcul); // 8 I/O Function
  sdio_builder.put_cmd_bits(1, 1, crc_calcul); // Not I/O Only
  sdio_builder.put_cmd_bits(0, 2, crc_calcul); // Stuff
  sdio_builder.put_cmd_bits(0, 1, crc_calcul); // Switch to 1.8V Accepted
  sdio_builder.put_cmd_bits(63, 6, crc_calcul); // 3.0-3.6V
  sdio_builder.put_cmd_bits(0, 18, crc_calcul); // I/O OCR
  sdio_builder.put_cmd_bits(127, 7, crc_calcul); // I/O OCR
  sdio_builder.put_end_cmd();
  sdio_builder.put_silence(10*sample_per_clock);
  crc_calcul = [];

  // CMD5 (I_O_SEND_OP_COND)
  sdio_builder.put_start_cmd(1, crc_calcul);
  sdio_builder.put_cmd_number(5, crc_calcul);
  sdio_builder.put_cmd_bits(0, 7, crc_calcul); // Stuff
  sdio_builder.put_cmd_bits(1, 1, crc_calcul); //S18R
  sdio_builder.put_cmd_bits(511, 9, crc_calcul); // 2.7-3.6V
  sdio_builder.put_cmd_bits(0, 15, crc_calcul);
  sdio_builder.put_crc7(crc_calcul);
  sdio_builder.put_end_cmd();
  sdio_builder.put_silence(10*sample_per_clock);
  crc_calcul = [];

  // R4 to CMD5
  sdio_builder.put_start_cmd(0, crc_calcul);
  sdio_builder.put_cmd_number(63, crc_calcul);
  sdio_builder.put_cmd_bits(1, 1, crc_calcul); // Ready to operate
  sdio_builder.put_cmd_bits(7, 3, crc_calcul); // 8 I/O Function
  sdio_builder.put_cmd_bits(1, 1, crc_calcul); // Not I/O Only
  sdio_builder.put_cmd_bits(0, 2, crc_calcul); // Stuff
  sdio_builder.put_cmd_bits(1, 1, crc_calcul); // Switch to 1.8V Accepted
  sdio_builder.put_cmd_bits(63, 6, crc_calcul); // 3.0-3.6V
  sdio_builder.put_cmd_bits(0, 18, crc_calcul); // I/O OCR
  sdio_builder.put_cmd_bits(127, 7, crc_calcul); // I/O OCR
  sdio_builder.put_end_cmd();
  sdio_builder.put_silence(10*sample_per_clock);
  crc_calcul = [];

  if(SDIO_only == false)
  {

      // CMD55, Next CMD is ACMD
      sdio_builder.put_start_cmd(1, crc_calcul);
      sdio_builder.put_cmd_number(55, crc_calcul);
      sdio_builder.put_cmd_bits(0, 16, crc_calcul); // RCA (0h0000)
      sdio_builder.put_cmd_bits(0, 16, crc_calcul); // Stuff bits
      sdio_builder.put_crc7(crc_calcul);
      sdio_builder.put_end_cmd();
      sdio_builder.put_silence(10*sample_per_clock);
      crc_calcul = [];

      // R1 to CMD 55
      sdio_builder.put_start_cmd(0, crc_calcul);
      sdio_builder.put_cmd_number(55, crc_calcul);
      sdio_builder.put_cmd_bits(288, 32, crc_calcul); // RCA
      sdio_builder.put_crc7(crc_calcul);
      sdio_builder.put_end_cmd();
      sdio_builder.put_silence(10*sample_per_clock);
      crc_calcul = [];

      // ACMD 41
      sdio_builder.put_start_cmd(1, crc_calcul);
      sdio_builder.put_cmd_number(41, crc_calcul);
      sdio_builder.put_cmd_bits(0, 1, crc_calcul); // Busy
      sdio_builder.put_cmd_bits(1, 1, crc_calcul); // Host Support SDXC and SDHC
      sdio_builder.put_cmd_bits(0, 1, crc_calcul); // (FB)
      sdio_builder.put_cmd_bits(0, 1, crc_calcul); // XPC
      sdio_builder.put_cmd_bits(0, 3, crc_calcul); // Reserved bits
      sdio_builder.put_cmd_bits(1, 1, crc_calcul); // Use 1.8V
      sdio_builder.put_cmd_bits(63, 6, crc_calcul); // OCR (3.0-3.7V)
      sdio_builder.put_cmd_bits(0, 18, crc_calcul); // 0
      sdio_builder.put_crc7(crc_calcul);
      sdio_builder.put_end_cmd();
      sdio_builder.put_silence(10*sample_per_clock);
      crc_calcul = [];

      // R3 to ACMD 41
      sdio_builder.put_start_cmd(0, crc_calcul);
      sdio_builder.put_cmd_number(63, crc_calcul); // Reserved bits
      sdio_builder.put_cmd_bits(1, 1, crc_calcul); // Not Busy
      sdio_builder.put_cmd_bits(1, 1, crc_calcul); // CCS ready
      sdio_builder.put_cmd_bits(0, 1, crc_calcul); // UHS-II Card Status
      sdio_builder.put_cmd_bits(0, 1, crc_calcul); // Reserved
      sdio_builder.put_cmd_bits(0, 1, crc_calcul); // Don't support 2TB status
      sdio_builder.put_cmd_bits(0, 2, crc_calcul);
      sdio_builder.put_cmd_bits(1, 1, crc_calcul); // S18A
      sdio_builder.put_cmd_bits(511, 9, crc_calcul); // VDD voltage windows 2.7-3.6V
      sdio_builder.put_cmd_bits(0, 15, crc_calcul); // Reserved bits
      sdio_builder.put_end_cmd();
      sdio_builder.put_silence(10*sample_per_clock);
      crc_calcul = [];

      // CMD11 (VOLTAGE_SWITCH)
      sdio_builder.put_start_cmd(1, crc_calcul);
      sdio_builder.put_cmd_number(11, crc_calcul);
      sdio_builder.put_cmd_bits(0, 32, crc_calcul); // Stuff Bits
      sdio_builder.put_crc7(crc_calcul);
      sdio_builder.put_end_cmd();
      sdio_builder.put_silence(10*sample_per_clock);
      crc_calcul = [];

      // R1 to CMD 11
      sdio_builder.put_start_cmd(0, crc_calcul);
      sdio_builder.put_cmd_number(11, crc_calcul);
      sdio_builder.put_cmd_bits(0, 19, crc_calcul); // no card status error
      sdio_builder.put_cmd_bits(2, 4, crc_calcul); // Current State : iden
      sdio_builder.put_cmd_bits(0, 9, crc_calcul); // no card status error
      sdio_builder.put_crc7(crc_calcul);
      sdio_builder.put_end_cmd();
      sdio_builder.put_silence(10*sample_per_clock);
      crc_calcul = [];


      // CMD2 (SEND_CID)
      sdio_builder.put_start_cmd(1, crc_calcul);
      sdio_builder.put_cmd_number(2, crc_calcul);
      sdio_builder.put_cmd_bits(0, 32, crc_calcul); // Stuff bits
      sdio_builder.put_crc7(crc_calcul);
      sdio_builder.put_end_cmd();
      sdio_builder.put_silence(10*sample_per_clock);
      crc_calcul = [];

      // R2 to CMD2
      sdio_builder.put_start_cmd(0, crc_calcul);
      sdio_builder.put_cmd_number(63, crc_calcul); // Reserved Bits
      crc_calcul = [];
      sdio_builder.put_rand_cmd_bit(8, crc_calcul); // Manufacturer ID
      sdio_builder.put_cmd_bits(20552, 16, crc_calcul); // OEM Application ID
      sdio_builder.put_cmd_bits(84, 8, crc_calcul); // Product Name
      sdio_builder.put_cmd_bits(69, 8, crc_calcul); // Product Name
      sdio_builder.put_cmd_bits(83, 8, crc_calcul); // Product Name
      sdio_builder.put_cmd_bits(84, 8, crc_calcul); // Product Name
      sdio_builder.put_cmd_bits(0, 8, crc_calcul); // Product Name
      sdio_builder.put_cmd_bits(48, 8, crc_calcul); // Product Revision 3.0
      sdio_builder.put_rand_cmd_bit(32, crc_calcul); // Product Serial Number
      sdio_builder.put_cmd_bits(0, 4, crc_calcul); // Reserved Bits
      sdio_builder.put_cmd_bits(200, 12, crc_calcul); // Manufacturing Date
      sdio_builder.put_crc7(crc_calcul);
      sdio_builder.put_end_cmd();
      sdio_builder.put_silence(10*sample_per_clock);
      crc_calcul = [];

      // CMD3 (SEND_RCA)
      sdio_builder.put_start_cmd(1, crc_calcul);
      sdio_builder.put_cmd_number(3, crc_calcul);
      sdio_builder.put_cmd_bits(0, 32, crc_calcul); // Stuff bits
      sdio_builder.put_crc7(crc_calcul);
      sdio_builder.put_end_cmd();
      sdio_builder.put_silence(10*sample_per_clock);
      crc_calcul = [];

      // R6 to CMD3
      sdio_builder.put_start_cmd(0, crc_calcul);
      sdio_builder.put_cmd_number(3, crc_calcul);
      sdio_builder.put_cmd_bits(7, 16, crc_calcul); // New RCA
      sdio_builder.put_cmd_bits(1280, 16, crc_calcul); // Card Status Bits
      sdio_builder.put_crc7(crc_calcul);
      sdio_builder.put_end_cmd();
      sdio_builder.put_silence(10*sample_per_clock);
      crc_calcul = [];

      // CMD9 (SEND_CSD)
      sdio_builder.put_start_cmd(1, crc_calcul);
      sdio_builder.put_cmd_number(9, crc_calcul);
      sdio_builder.put_cmd_bits(0, 32, crc_calcul); // Stuff bits
      sdio_builder.put_crc7(crc_calcul);
      sdio_builder.put_end_cmd();
      sdio_builder.put_silence(10*sample_per_clock);
      crc_calcul = [];

      // R2 to CMD9
      sdio_builder.put_start_cmd(0, crc_calcul);
      sdio_builder.put_cmd_number(63, crc_calcul);
      crc_calcul = [];
      sdio_builder.put_cmd_bits(1, 2, crc_calcul); // CSD Version 2.0
      sdio_builder.put_cmd_bits(0, 6, crc_calcul); // Reserved Bits
      sdio_builder.put_cmd_bits(14, 8, crc_calcul); //TAAC
      sdio_builder.put_cmd_bits(0, 8, crc_calcul); //NSAC
      sdio_builder.put_cmd_bits(50, 8, crc_calcul); //TRAN_SPEED
      sdio_builder.put_cmd_bits(3509, 12, crc_calcul); //CCC
      sdio_builder.put_cmd_bits(9, 4, crc_calcul); //READ_BL_LEN
      sdio_builder.put_cmd_bits(0, 1, crc_calcul); //READ_BL_PARTIAL
      sdio_builder.put_cmd_bits(0, 1, crc_calcul); //WRITE_BLK_MISALIGN
      sdio_builder.put_cmd_bits(0, 1, crc_calcul); //READ_BLK_MISALIGN
      sdio_builder.put_cmd_bits(0, 1, crc_calcul); //DSR_IMP
      sdio_builder.put_cmd_bits(0, 6, crc_calcul); //reserved
      sdio_builder.put_cmd_bits(4112, 22, crc_calcul); //C_SIZE
      sdio_builder.put_cmd_bits(0, 1, crc_calcul); //reserved
      sdio_builder.put_cmd_bits(1, 1, crc_calcul); //ERASE_BLK_EN
      sdio_builder.put_cmd_bits(127, 7, crc_calcul); //SECTOR_SIZE
      sdio_builder.put_cmd_bits(0, 7, crc_calcul); //WP_GRP_SIZE
      sdio_builder.put_cmd_bits(0, 1, crc_calcul); //WP_GRP_ENABLE
      sdio_builder.put_cmd_bits(0, 2, crc_calcul); //reserved
      sdio_builder.put_cmd_bits(2, 3, crc_calcul); //R2W_FACTOR
      sdio_builder.put_cmd_bits(9, 4, crc_calcul); //WRITE_BL_LEN
      sdio_builder.put_cmd_bits(0, 1, crc_calcul); //WRITE_BL_PARTIAL
      sdio_builder.put_cmd_bits(0, 5, crc_calcul); //reserved
      sdio_builder.put_cmd_bits(0, 1, crc_calcul); //FILE_FORMAT_GRP
      sdio_builder.put_cmd_bits(0, 1, crc_calcul); //COPY
      sdio_builder.put_cmd_bits(0, 1, crc_calcul); //PERM_WRITE_PROTECT
      sdio_builder.put_cmd_bits(0, 1, crc_calcul); //TMP_WRITE_PROTECT
      sdio_builder.put_cmd_bits(0, 2, crc_calcul); //FILE_FORMAT_GRP
      sdio_builder.put_cmd_bits(0, 2, crc_calcul); //Reserved
      sdio_builder.put_crc7(crc_calcul);
      sdio_builder.put_end_cmd();
      sdio_builder.put_silence(10*sample_per_clock);
      crc_calcul = [];
  }

  // CMD7 (SELECT_DESELECT_CARD)
  sdio_builder.put_start_cmd(1, crc_calcul);
  sdio_builder.put_cmd_number(7, crc_calcul);
  sdio_builder.put_cmd_bits(7, 16, crc_calcul); // RCA
  sdio_builder.put_cmd_bits(0, 16, crc_calcul); // OCR
  sdio_builder.put_crc7(crc_calcul);
  sdio_builder.put_end_cmd();
  sdio_builder.put_silence(10*sample_per_clock);
  crc_calcul = [];

  // R1b to CMD7
  sdio_builder.put_start_cmd(0, crc_calcul);
  sdio_builder.put_cmd_number(7, crc_calcul);
  sdio_builder.put_cmd_bits(1792, 32, crc_calcul); // Current state STAND BY
  sdio_builder.put_crc7(crc_calcul);
  sdio_builder.put_end_cmd();
  sdio_builder.put_silence(10*sample_per_clock);
  crc_calcul = [];

  // CMD55, Next CMD is ACMD
  sdio_builder.put_start_cmd(1, crc_calcul);
  sdio_builder.put_cmd_number(55, crc_calcul);
  sdio_builder.put_cmd_bits(7, 16, crc_calcul); // RCA (0h0007)
  sdio_builder.put_cmd_bits(0, 16, crc_calcul); // Stuff bits
  sdio_builder.put_crc7(crc_calcul);
  sdio_builder.put_end_cmd();
  sdio_builder.put_silence(10*sample_per_clock);
  crc_calcul = [];

  // R1 to CMD 55
  sdio_builder.put_start_cmd(0, crc_calcul);
  sdio_builder.put_cmd_number(55, crc_calcul);
  sdio_builder.put_cmd_bits(2336, 32, crc_calcul); // Current state tran and app_cmd_enabled
  sdio_builder.put_crc7(crc_calcul);
  sdio_builder.put_end_cmd();
  sdio_builder.put_silence(10*sample_per_clock);
  crc_calcul = [];

  // ACMD6, SET_BUS_WIDTH
  sdio_builder.put_start_cmd(1, crc_calcul);
  sdio_builder.put_cmd_number(6, crc_calcul);
  sdio_builder.put_cmd_bits(0, 30, crc_calcul); // RCA (0h0007)
  if(speed_mode == 1)
  {
      sdio_builder.put_cmd_bits(2, 2, crc_calcul); // Bus width : 4 DAT lines
  }
  else
  {
      sdio_builder.put_cmd_bits(0, 2, crc_calcul); // Bus width : 1 DAT lines
  }
  sdio_builder.put_crc7(crc_calcul);
  sdio_builder.put_end_cmd();
  sdio_builder.put_silence(10*sample_per_clock);
  crc_calcul = [];

  // R1 to ACMD6
  sdio_builder.put_start_cmd(0, crc_calcul);
  sdio_builder.put_cmd_number(6, crc_calcul);
  sdio_builder.put_cmd_bits(2336, 32, crc_calcul); // Current state tran and app_cmd_enabled
  sdio_builder.put_crc7(crc_calcul);
  sdio_builder.put_end_cmd();
  sdio_builder.put_silence(10*sample_per_clock);
  crc_calcul = [];

  // CMD55, Next CMD is ACMD
  sdio_builder.put_start_cmd(1, crc_calcul);
  sdio_builder.put_cmd_number(55, crc_calcul);
  sdio_builder.put_cmd_bits(7, 16, crc_calcul); // RCA (0h0007)
  sdio_builder.put_cmd_bits(0, 16, crc_calcul); // Stuff bits
  sdio_builder.put_crc7(crc_calcul);
  sdio_builder.put_end_cmd();
  sdio_builder.put_silence(10*sample_per_clock);
  crc_calcul = [];

  // R1 to CMD 55
  sdio_builder.put_start_cmd(0, crc_calcul);
  sdio_builder.put_cmd_number(55, crc_calcul);
  sdio_builder.put_cmd_bits(2336, 32, crc_calcul); // Current state tran and app_cmd_enabled
  sdio_builder.put_crc7(crc_calcul);
  sdio_builder.put_end_cmd();
  sdio_builder.put_silence(10*sample_per_clock);
  crc_calcul = [];

  // ACMD51, SEND_SCR
  sdio_builder.put_start_cmd(1, crc_calcul);
  sdio_builder.put_cmd_number(51, crc_calcul);
  sdio_builder.put_cmd_bits(0, 32, crc_calcul); // RCA (0h0007)
  sdio_builder.put_crc7(crc_calcul);
  sdio_builder.put_end_cmd();
  sdio_builder.put_silence(10*sample_per_clock);
  crc_calcul = [];

  // R1 to ACMD51
  sdio_builder.put_start_cmd(0, crc_calcul);
  sdio_builder.put_cmd_number(51, crc_calcul);
  sdio_builder.put_cmd_bits(2336, 32, crc_calcul); // Current state tran and app_cmd_enabled
  sdio_builder.put_crc7(crc_calcul);
  sdio_builder.put_end_cmd();
  sdio_builder.put_silence(10*sample_per_clock);
  crc_calcul = [];

  //SCR Register
  sdio_builder.put_silence(10*sample_per_clock);
  sdio_builder.put_start_data();
  sdio_builder.put_data_bits(2,8,crc_calcul); //SCR_STRUCTURE and SD_SPEC
  sdio_builder.put_data_bits(53,8,crc_calcul); //DATA_STAT_AFTER_ERASE and SD_SECURITY and SD_BUS_WIDTH
  sdio_builder.put_data_bits(128,8,crc_calcul); //SD_SPEC3 and EX_SECURITY and SD_SPEC_4
  sdio_builder.put_data_bits(3,8,crc_calcul); //SD_SPEC4 and SD_SPECX and CMD_SUPPORT
  sdio_builder.put_data_bits(1,8,crc_calcul); //Reserved for manufacturer and
  sdio_builder.put_data_bits(0,24,crc_calcul);
  sdio_builder.put_crc16(crc_calcul);
  sdio_builder.put_end_data(); //data end
  crc_calcul = [];

  // CMD6, SWITCH_FUNC (CHECK if we can switch)
  sdio_builder.put_start_cmd(1, crc_calcul);
  sdio_builder.put_cmd_number(6, crc_calcul);
  sdio_builder.put_cmd_bits(0, 1, crc_calcul); // Check
  sdio_builder.put_cmd_bits(0, 7, crc_calcul); //reserved
  sdio_builder.put_cmd_bits(15, 4, crc_calcul); //group 6 (reserved)
  sdio_builder.put_cmd_bits(15, 4, crc_calcul); //group 5 (reserved)
  sdio_builder.put_cmd_bits(15, 4, crc_calcul); //Power Limit
  sdio_builder.put_cmd_bits(15, 4, crc_calcul); //Drive Strength
  sdio_builder.put_cmd_bits(15, 4, crc_calcul); //Command system
  sdio_builder.put_cmd_bits(1, 4, crc_calcul); // Access Mode (check SDR25 if supported)
  sdio_builder.put_crc7(crc_calcul);
  sdio_builder.put_end_cmd();
  sdio_builder.put_silence(10*sample_per_clock);
  crc_calcul = [];

  // R1 to CMD6
  sdio_builder.put_start_cmd(0, crc_calcul);
  sdio_builder.put_cmd_number(55, crc_calcul);
  sdio_builder.put_cmd_bits(2304, 32, crc_calcul); // Current state tran
  sdio_builder.put_crc7(crc_calcul);
  sdio_builder.put_end_cmd();
  sdio_builder.put_silence(10*sample_per_clock);
  crc_calcul = [];

  //Status Data Structure
  sdio_builder.put_silence(10*sample_per_clock);
  sdio_builder.put_start_data();
  sdio_builder.put_data_bits(100,16,crc_calcul); //Max Current
  sdio_builder.put_data_bits(32769,16,crc_calcul); //Function 15/0 of group 6
  sdio_builder.put_data_bits(32769,16,crc_calcul); //Function 15/0 of group 5
  sdio_builder.put_data_bits(32769,16,crc_calcul); //Function 15/0 of group 4
  sdio_builder.put_data_bits(32769,16,crc_calcul); //Function 15/0 of group 3
  sdio_builder.put_data_bits(32769,16,crc_calcul); //Function 15/0 of group 2
  sdio_builder.put_data_bits(32771,16,crc_calcul); //Function 15/1/0 of group 1
  sdio_builder.put_data_bits(0,4,crc_calcul); //You can't switch
  sdio_builder.put_data_bits(0,4,crc_calcul); //You can't switch
  sdio_builder.put_data_bits(0,4,crc_calcul); //You can't switch
  sdio_builder.put_data_bits(0,4,crc_calcul); //You can't switch
  sdio_builder.put_data_bits(0,4,crc_calcul); //You can't switch
  sdio_builder.put_data_bits(1,4,crc_calcul); //You can switch to function 1 of group 1
  sdio_builder.put_data_bits(0,8,crc_calcul); //Rest are reserved bits
  sdio_builder.put_data_bits(0,368,crc_calcul); //Reserved Bits
  sdio_builder.put_crc16(crc_calcul);
  sdio_builder.put_end_data(); //data end
  crc_calcul = [];

  // CMD6, SWITCH_FUNC (switch to the function we checked before)
  sdio_builder.put_start_cmd(1, crc_calcul);
  sdio_builder.put_cmd_number(6, crc_calcul);
  sdio_builder.put_cmd_bits(1, 1, crc_calcul); // Check
  sdio_builder.put_cmd_bits(0, 7, crc_calcul); //reserved
  sdio_builder.put_cmd_bits(15, 4, crc_calcul); //group 6 (reserved)
  sdio_builder.put_cmd_bits(15, 4, crc_calcul); //group 5 (reserved)
  sdio_builder.put_cmd_bits(15, 4, crc_calcul); //Power Limit
  sdio_builder.put_cmd_bits(15, 4, crc_calcul); //Drive Strength
  sdio_builder.put_cmd_bits(15, 4, crc_calcul); //Command system
  sdio_builder.put_cmd_bits(1, 4, crc_calcul); // Access Mode (check SDR25 if supported)
  sdio_builder.put_crc7(crc_calcul);
  sdio_builder.put_end_cmd();
  sdio_builder.put_silence(10*sample_per_clock);
  crc_calcul = [];

  // R1 to CMD6
  sdio_builder.put_start_cmd(0, crc_calcul);
  sdio_builder.put_cmd_number(55, crc_calcul);
  sdio_builder.put_cmd_bits(2304, 32, crc_calcul); // Current state tran
  sdio_builder.put_crc7(crc_calcul);
  sdio_builder.put_end_cmd();
  sdio_builder.put_silence(10*sample_per_clock);
  crc_calcul = [];

  //Status Data Structure
  sdio_builder.put_silence(10*sample_per_clock);
  sdio_builder.put_start_data();
  sdio_builder.put_data_bits(100,16,crc_calcul); //Max Current
  sdio_builder.put_data_bits(32769,16,crc_calcul); //Function 15/0 of group 6
  sdio_builder.put_data_bits(32769,16,crc_calcul); //Function 15/0 of group 5
  sdio_builder.put_data_bits(32769,16,crc_calcul); //Function 15/0 of group 4
  sdio_builder.put_data_bits(32769,16,crc_calcul); //Function 15/0 of group 3
  sdio_builder.put_data_bits(32769,16,crc_calcul); //Function 15/0 of group 2
  sdio_builder.put_data_bits(32771,16,crc_calcul); //Function 15/1/0 of group 1
  sdio_builder.put_data_bits(0,4,crc_calcul); //You can't switch
  sdio_builder.put_data_bits(0,4,crc_calcul); //You can't switch
  sdio_builder.put_data_bits(0,4,crc_calcul); //You can't switch
  sdio_builder.put_data_bits(0,4,crc_calcul); //You can't switch
  sdio_builder.put_data_bits(0,4,crc_calcul); //You can't switch
  sdio_builder.put_data_bits(1,4,crc_calcul); //You switch to the function 1 of group 1 (SDR25)
  sdio_builder.put_data_bits(0,8,crc_calcul); //Rest are reserved bits
  sdio_builder.put_data_bits(0,368,crc_calcul); //Reserved Bits
  sdio_builder.put_crc16(crc_calcul);
  sdio_builder.put_end_data(); //data end
  crc_calcul = [];

  // Change block_size function 0 to 512 byte per block
  sdio_builder.put_start_cmd(1, crc_calcul);
  sdio_builder.put_cmd_number(52, crc_calcul);
  sdio_builder.put_cmd_bits(1, 1, crc_calcul); // R/W
  sdio_builder.put_cmd_bits(0, 3, crc_calcul); // function number
  sdio_builder.put_cmd_bits(1, 1, crc_calcul); // RAW
  sdio_builder.put_cmd_bits(0, 1, crc_calcul); // Stuff
  sdio_builder.put_cmd_bits(17, 17, crc_calcul); // Register adress
  sdio_builder.put_cmd_bits(0, 1, crc_calcul); // Stuff
  sdio_builder.put_cmd_bits(0, 8, crc_calcul); // Write
  sdio_builder.put_crc7(crc_calcul);
  sdio_builder.put_end_cmd();
  sdio_builder.put_silence(10*sample_per_clock);
  crc_calcul = [];

  sdio_builder.put_start_cmd(0, crc_calcul);
  sdio_builder.put_cmd_number(52, crc_calcul);
  sdio_builder.put_cmd_bits(0, 16, crc_calcul); //Stuff
  sdio_builder.put_cmd_bits(0, 8, crc_calcul); // Respond no error to the write cmd and current state : dis
  sdio_builder.put_cmd_bits(0, 8, crc_calcul); //
  sdio_builder.put_crc7(crc_calcul);
  sdio_builder.put_end_cmd();
  sdio_builder.put_silence(10*sample_per_clock);
  crc_calcul = [];

  // sdio_builder.put_silence(silence_period);
  sdio_builder.put_start_cmd(1, crc_calcul);
  sdio_builder.put_cmd_number(52, crc_calcul);
  sdio_builder.put_cmd_bits(1, 1, crc_calcul); // R/W
  sdio_builder.put_cmd_bits(0, 3, crc_calcul); // function number
  sdio_builder.put_cmd_bits(1, 1, crc_calcul); // RAW
  sdio_builder.put_cmd_bits(0, 1, crc_calcul); // Stuff
  sdio_builder.put_cmd_bits(16, 17, crc_calcul); // Register adress
  sdio_builder.put_cmd_bits(0, 1, crc_calcul); // Stuff
  sdio_builder.put_cmd_bits(2, 8, crc_calcul); // Write
  sdio_builder.put_crc7(crc_calcul);
  sdio_builder.put_end_cmd();
  sdio_builder.put_silence(10*sample_per_clock);
  crc_calcul = [];

  sdio_builder.put_start_cmd(0, crc_calcul);
  sdio_builder.put_cmd_number(52, crc_calcul);
  sdio_builder.put_cmd_bits(0, 16, crc_calcul); //Stuff
  sdio_builder.put_cmd_bits(0, 8, crc_calcul); // Respond no error to the write cmd and current state : dis
  sdio_builder.put_cmd_bits(2, 8, crc_calcul);
  sdio_builder.put_crc7(crc_calcul);
  sdio_builder.put_end_cmd();
  sdio_builder.put_silence(10*sample_per_clock);
  crc_calcul = [];

  // CMD53 Send I/O block data
  sdio_builder.put_start_cmd(1, crc_calcul);
  sdio_builder.put_cmd_number(53, crc_calcul);
  sdio_builder.put_cmd_bits(1, 1, crc_calcul); // R/W
  sdio_builder.put_cmd_bits(0, 3, crc_calcul); // function number
  sdio_builder.put_cmd_bits(1, 1, crc_calcul); // Block mode
  sdio_builder.put_cmd_bits(1, 1, crc_calcul); // OP Code
  sdio_builder.put_cmd_bits(17, 17, crc_calcul); // Register adress
  sdio_builder.put_cmd_bits(1, 9, crc_calcul); // Block/Byte Count : 1
  sdio_builder.put_crc7(crc_calcul);
  sdio_builder.put_end_cmd();
  sdio_builder.put_silence(10*sample_per_clock);
  crc_calcul = [];

  sdio_builder.put_start_cmd(0, crc_calcul);
  sdio_builder.put_cmd_number(53, crc_calcul);
  sdio_builder.put_cmd_bits(0, 16, crc_calcul); //Stuff
  sdio_builder.put_cmd_bits(0, 2, crc_calcul); // Respond no error to the write cmd
  sdio_builder.put_cmd_bits(2, 2, crc_calcul); // Current state : TRN
  sdio_builder.put_cmd_bits(0, 4, crc_calcul); // Respond no error to the write cmd
  sdio_builder.put_cmd_bits(0, 8, crc_calcul); // stuff bit because CMD53
  sdio_builder.put_crc7(crc_calcul);
  sdio_builder.put_end_cmd();
  sdio_builder.put_silence(10*sample_per_clock);
  crc_calcul = [];

  sdio_builder.put_silence(10*sample_per_clock);
  data_bits = switch_nb_data_bits(cmd_number,last_CMD_mode);
  sdio_builder.put_start_data();
  sdio_builder.put_rand_data_bit(data_bits,crc_calcul);
  sdio_builder.put_crc16(crc_calcul);
  sdio_builder.put_end_data(); //data end
  crc_calcul = [];

  // CMD52 (STOP_IO_TRANSMISSION)
  sdio_builder.put_start_cmd(1, crc_calcul);
  sdio_builder.put_cmd_number(52, crc_calcul);
  sdio_builder.put_cmd_bits(1, 1, crc_calcul); // R/W
  sdio_builder.put_cmd_bits(0, 3, crc_calcul); // function number
  sdio_builder.put_cmd_bits(1, 1, crc_calcul); // RAW
  sdio_builder.put_cmd_bits(0, 1, crc_calcul); // Stuff
  sdio_builder.put_cmd_bits(6, 17, crc_calcul); // Register adress
  sdio_builder.put_cmd_bits(0, 1, crc_calcul); // Stuff
  sdio_builder.put_cmd_bits(0, 8, crc_calcul); // Write
  sdio_builder.put_crc7(crc_calcul);
  sdio_builder.put_end_cmd();
  sdio_builder.put_silence(10*sample_per_clock);
  crc_calcul = [];

  sdio_builder.put_start_cmd(0, crc_calcul);
  sdio_builder.put_cmd_number(52, crc_calcul);
  sdio_builder.put_cmd_bits(0, 16, crc_calcul); //Stuff
  sdio_builder.put_cmd_bits(0, 2, crc_calcul); // Respond no error to the write cmd
  sdio_builder.put_cmd_bits(2, 2, crc_calcul); // Current state : TRN
  sdio_builder.put_cmd_bits(0, 4, crc_calcul); // Respond no error to the write cmd
  sdio_builder.put_cmd_bits(2, 8, crc_calcul);
  sdio_builder.put_crc7(crc_calcul);
  sdio_builder.put_end_cmd();
  sdio_builder.put_silence(10*sample_per_clock);
  crc_calcul = [];


  R_type = "Undefined";
  current_state = "stby";


  while( ScanaStudio.builder_get_samples_acc(cmd_channel) < samples_to_build )
  {
      if (R_type != "Undefined") // Response
      {
          sdio_builder.put_silence(10*sample_per_clock);
          sdio_builder.put_start_cmd(0,crc_calcul);
          var rng_bit = Math.floor(Math.random()*2);
          switch (R_type)
          {
              case "R1" :
              {
                  sdio_builder.put_cmd_number(cmd_number,crc_calcul);
                  if (rng_bit == 1) // we create random bits
                  {
                      sdio_builder.put_rand_cmd_bit(32, crc_calcul); // Fill Argument with random bits
                  }
                  else
                  {
                      sdio_builder.put_cmd_bits(0, 19, crc_calcul); // no card status error
                      sdio_builder.put_cmd_bits(current_state_value, 4, crc_calcul); // Current State
                      sdio_builder.put_cmd_bits(0, 9, crc_calcul); // no card status error
                  }
                  break;
              }
              case "R1b" :
              {
                  sdio_builder.put_cmd_number(cmd_number,crc_calcul);
                  if (rng_bit == 1) // we create random bits
                  {
                      sdio_builder.put_rand_cmd_bit(32, crc_calcul); // Fill Argument with random bits
                  }
                  else
                  {
                      sdio_builder.put_cmd_bits(0, 19, crc_calcul); // no card status error
                      sdio_builder.put_cmd_bits(current_state_value, 4, crc_calcul); // Current State
                      sdio_builder.put_cmd_bits(0, 9, crc_calcul); // no card status error
                  }
                    break;
              }
              case "R2" :
              {
                  sdio_builder.put_cmd_number(63,crc_calcul);
                  crc_calcul = [];
                  if (rng_bit == 1) // we create random bits
                  {
                      sdio_builder.put_rand_cmd_bit(120, crc_calcul); // Fill Argument with random bits
                  }
                  else
                  {
                      if (cmd_number == 2 || cmd_number == 10)
                      {
                          // R2 to CMD2
                          sdio_builder.put_rand_cmd_bit(8, crc_calcul); // Manufacturer ID
                          sdio_builder.put_cmd_bits(20552, 16, crc_calcul); // OEM Application ID
                          sdio_builder.put_cmd_bits(84, 8, crc_calcul); // Product Name
                          sdio_builder.put_cmd_bits(69, 8, crc_calcul); // Product Name
                          sdio_builder.put_cmd_bits(83, 8, crc_calcul); // Product Name
                          sdio_builder.put_cmd_bits(84, 8, crc_calcul); // Product Name
                          sdio_builder.put_cmd_bits(0, 8, crc_calcul); // Product Name
                          sdio_builder.put_cmd_bits(48, 8, crc_calcul); // Product Revision 3.0
                          sdio_builder.put_rand_cmd_bit(32, crc_calcul); // Product Serial Number
                          sdio_builder.put_cmd_bits(0, 4, crc_calcul); // Reserved Bits
                          sdio_builder.put_cmd_bits(200, 12, crc_calcul); // Manufacturing Date
                      }
                      else if (cmd_number == 9)
                      {
                          // R2 to CMD9
                          sdio_builder.put_cmd_bits(1, 2, crc_calcul); // CSD Version 2.0
                          sdio_builder.put_cmd_bits(0, 6, crc_calcul); // Reserved Bits
                          sdio_builder.put_cmd_bits(14, 8, crc_calcul); //TAAC
                          sdio_builder.put_cmd_bits(0, 8, crc_calcul); //NSAC
                          sdio_builder.put_cmd_bits(50, 8, crc_calcul); //TRAN_SPEED
                          sdio_builder.put_cmd_bits(3509, 12, crc_calcul); //CCC
                          sdio_builder.put_cmd_bits(9, 4, crc_calcul); //READ_BL_LEN
                          sdio_builder.put_cmd_bits(0, 1, crc_calcul); //READ_BL_PARTIAL
                          sdio_builder.put_cmd_bits(0, 1, crc_calcul); //WRITE_BLK_MISALIGN
                          sdio_builder.put_cmd_bits(0, 1, crc_calcul); //READ_BLK_MISALIGN
                          sdio_builder.put_cmd_bits(0, 1, crc_calcul); //DSR_IMP
                          sdio_builder.put_cmd_bits(0, 6, crc_calcul); //reserved
                          sdio_builder.put_cmd_bits(4112, 22, crc_calcul); //C_SIZE
                          sdio_builder.put_cmd_bits(0, 1, crc_calcul); //reserved
                          sdio_builder.put_cmd_bits(1, 1, crc_calcul); //ERASE_BLK_EN
                          sdio_builder.put_cmd_bits(127, 7, crc_calcul); //SECTOR_SIZE
                          sdio_builder.put_cmd_bits(0, 7, crc_calcul); //WP_GRP_SIZE
                          sdio_builder.put_cmd_bits(0, 1, crc_calcul); //WP_GRP_ENABLE
                          sdio_builder.put_cmd_bits(0, 2, crc_calcul); //reserved
                          sdio_builder.put_cmd_bits(2, 3, crc_calcul); //R2W_FACTOR
                          sdio_builder.put_cmd_bits(9, 4, crc_calcul); //WRITE_BL_LEN
                          sdio_builder.put_cmd_bits(0, 1, crc_calcul); //WRITE_BL_PARTIAL
                          sdio_builder.put_cmd_bits(0, 5, crc_calcul); //reserved
                          sdio_builder.put_cmd_bits(0, 1, crc_calcul); //FILE_FORMAT_GRP
                          sdio_builder.put_cmd_bits(0, 1, crc_calcul); //COPY
                          sdio_builder.put_cmd_bits(0, 1, crc_calcul); //PERM_WRITE_PROTECT
                          sdio_builder.put_cmd_bits(0, 1, crc_calcul); //TMP_WRITE_PROTECT
                          sdio_builder.put_cmd_bits(0, 2, crc_calcul); //FILE_FORMAT_GRP
                          sdio_builder.put_cmd_bits(0, 2, crc_calcul); //Reserved
                      }
                  }
                    break;
              }
              case "R3" :
              {
                  sdio_builder.put_cmd_number(63,crc_calcul);
                  if (rng_bit == 1) // we create random bits
                  {
                      sdio_builder.put_rand_cmd_bit(32, crc_calcul); // Fill Argument with random bits
                  }
                  else
                  {
                      sdio_builder.put_cmd_bits(0, 8, crc_calcul);
                      sdio_builder.put_cmd_bits(1, 9, crc_calcul); // VDD Voltage Windows 2.7-3.7V
                      sdio_builder.put_cmd_bits(0,15, crc_calcul);
                  }
                    break;
              }
              case "R4" :
              {
                  sdio_builder.put_cmd_number(63,crc_calcul); // Reserved bit, 1
                  if (rng_bit == 1) // we create random bits
                  {
                      sdio_builder.put_rand_cmd_bit(32, crc_calcul); // Fill Argument with random bits
                      sdio_builder.put_cmd_bits(0,7, crc_calcul);
                  }
                  else
                  {
                      sdio_builder.put_cmd_bits(31, 5, crc_calcul); // Card Ready, all 7 functions supported and has SD memory
                      sdio_builder.put_cmd_bits(0, 2, crc_calcul); // Stuff bits
                      sdio_builder.put_cmd_bits(1,1, crc_calcul); // Switching to 1.8V Accepted (Supported in SD mode only)
                      sdio_builder.put_cmd_bits(511, 9, crc_calcul); // 2.7-3.7V
                      sdio_builder.put_cmd_bits(0, 15, crc_calcul); // Reserved, 0
                      sdio_builder.put_cmd_bits(127, 7, crc_calcul); // Reserved, 1 (there is no CRC for R4)
                  }
                    break;
              }
              case "R5" :
              {
                  sdio_builder.put_cmd_number(cmd_number, crc_calcul);
                  if (rng_bit == 1) // we create random bits
                  {
                      sdio_builder.put_rand_cmd_bit(32, crc_calcul); // Fill Argument with random bits
                  }
                  else
                  {
                      if (cmd_number == 52)
                      {
                          sdio_builder.put_cmd_bits(0, 16, crc_calcul); // Stuff bits
                          sdio_builder.put_cmd_bits(0,4, crc_calcul); // Response Flag, no error
                          sdio_builder.put_cmd_bits(1,4, crc_calcul); // Response Flag, current state = dis
                          sdio_builder.put_rand_cmd_bit(8, crc_calcul); // Fill Read/Write with random bit
                      }
                      else
                      {
                          sdio_builder.put_cmd_bits(0, 16, crc_calcul); // Stuff bits
                          sdio_builder.put_cmd_bits(0,4, crc_calcul); // Response Flag, no error
                          sdio_builder.put_cmd_bits(2,4, crc_calcul); // Response Flag, current state = dis
                          sdio_builder.put_cmd_bits(0, 8, crc_calcul); // Fill Read/Write with random bit
                      }
                  }
                    break;
              }
              case "R6" :
              {
                  sdio_builder.put_cmd_number(cmd_number, crc_calcul);
                  if (rng_bit == 1) // we create random bits
                  {
                      sdio_builder.put_rand_cmd_bit(32, crc_calcul); // Fill Argument with random bits
                  }
                  else
                  {
                      sdio_builder.put_cmd_bits(0, 16, crc_calcul); // Stuff bits
                      sdio_builder.put_cmd_bits(0,3, crc_calcul); // Card Status (no error)
                      sdio_builder.put_cmd_bits(current_state_value, 4, crc_calcul); // Current State
                      sdio_builder.put_cmd_bits(1,1, crc_calcul); // Ready
                      sdio_builder.put_cmd_bits(0,8, crc_calcul); // Card Status (no error)
                  }
                    break;
              }
              case "R7" :
              {
                  sdio_builder.put_cmd_number(cmd_number, crc_calcul);
                  if (rng_bit == 1) // we create random bits
                  {
                      sdio_builder.put_rand_cmd_bit(32, crc_calcul); // Fill Argument with random bits
                  }
                  else
                  {
                      sdio_builder.put_cmd_bits(0, 18, crc_calcul); // Reserved bits
                      sdio_builder.put_cmd_bits(0,2, crc_calcul); // Card don't support 1.2V and PCIe
                      sdio_builder.put_cmd_bits(CMD8_Voltage,4, crc_calcul); // Return the Voltage to accept it
                      sdio_builder.put_cmd_bits(CMD8_check_pattern,8, crc_calcul); // Return the check pattern
                  }
                    break;
              }
          }
          if (R_type != "R4")
          {
              sdio_builder.put_crc7(crc_calcul);
          }
          sdio_builder.put_end_cmd();
          crc_calcul = [];
          lvl = 1;
          R_type = "Undefined";

          if (data_transfer_2 == true)
          {
              sdio_builder.put_silence(10*sample_per_clock);
              data_bits = switch_nb_data_bits(cmd_number,last_CMD_mode);
              sdio_builder.put_start_data();
              sdio_builder.put_rand_data_bit(data_bits,crc_calcul);
              sdio_builder.put_crc16(crc_calcul);
              sdio_builder.put_end_data(); //data end


              if (cmd_number == 18 || cmd_number == 25)
              {
                  crc_calcul = [];
                  sdio_builder.put_start_cmd(1, crc_calcul);
                  sdio_builder.put_cmd_number(12, crc_calcul);
                  sdio_builder.put_cmd_bits(0, 32, crc_calcul);
                  sdio_builder.put_crc7(crc_calcul);
                  sdio_builder.put_end_cmd();
                  sdio_builder.put_silence(8*sample_per_clock);
                  crc_calcul = [];

                  sdio_builder.put_start_cmd(0, crc_calcul);
                  sdio_builder.put_cmd_number(12, crc_calcul);
                  sdio_builder.put_cmd_bits(2816, 32, crc_calcul);
                  sdio_builder.put_crc7(crc_calcul);
                  sdio_builder.put_end_cmd();
                  sdio_builder.put_silence(silence_period);
                  crc_calcul = [];
              }
              else if (cmd_number == 53)
              {
                  // CMD52 (STOP_IO_TRANSMISSION)
                  crc_calcul = [];
                  sdio_builder.put_start_cmd(1, crc_calcul);
                  sdio_builder.put_cmd_number(52, crc_calcul);
                  sdio_builder.put_cmd_bits(1, 1, crc_calcul); // R/W
                  sdio_builder.put_cmd_bits(0, 3, crc_calcul); // function number
                  sdio_builder.put_cmd_bits(1, 1, crc_calcul); // RAW
                  sdio_builder.put_cmd_bits(0, 1, crc_calcul); // Stuff
                  sdio_builder.put_cmd_bits(6, 17, crc_calcul); // Register adress
                  sdio_builder.put_cmd_bits(0, 1, crc_calcul); // Stuff
                  sdio_builder.put_cmd_bits(0, 8, crc_calcul); // Write
                  sdio_builder.put_crc7(crc_calcul);
                  sdio_builder.put_end_cmd();
                  sdio_builder.put_silence(10*sample_per_clock);
                  crc_calcul = [];

                  sdio_builder.put_start_cmd(0, crc_calcul);
                  sdio_builder.put_cmd_number(52, crc_calcul);
                  sdio_builder.put_cmd_bits(0, 16, crc_calcul); //Stuff
                  sdio_builder.put_cmd_bits(0, 2, crc_calcul); // Respond no error to the write cmd
                  sdio_builder.put_cmd_bits(2, 2, crc_calcul); // Current state : TRN
                  sdio_builder.put_cmd_bits(0, 4, crc_calcul); // Respond no error to the write cmd
                  sdio_builder.put_cmd_bits(2, 8, crc_calcul);
                  sdio_builder.put_crc7(crc_calcul);
                  sdio_builder.put_end_cmd();
                  sdio_builder.put_silence(10*sample_per_clock);
                  crc_calcul = [];
              }

              crc_calcul = [];
              data_transfer_2 = false;
          }
          if (cmd_number == 53 || cmd_number == 18 || cmd_number == 25 || cmd_number == 58 || cmd_number == 59)
          {
              // Do nothing
          }
          else
          {
              sdio_builder.put_silence(silence_period);
          }
      }
      else // CMD
      {
          last_CMD_mode = CMD_mode;
          update_current_state(cmd_number, CMD_mode, transfer);
          cmd_number = switch_cmd_number(current_state, cmd_number);
          rng = 0;
          rng = Math.floor(Math.random()*1.1);
          if (rng == 1)
          {
              cmd_number = 13;
          }
          transfer = "operation not complete";


          if (data_transfer_2 == true)
          {
              sdio_builder.put_silence(10*sample_per_clock);
              sdio_builder.put_start_data();
              data_bits = switch_nb_data_bits(cmd_number,CMD_mode);
              sdio_builder.put_rand_data_bit(data_bits,crc_calcul);
              sdio_builder.put_crc16(crc_calcul);
              sdio_builder.put_end_data(); //data end
              crc_calcul = [];
              data_transfer_2 = false;
              transfer = "operation complete";
          }
          if (CMD_mode == 1) //ACMD
          {
              sdio_builder.put_silence(silence_period);
              sdio_builder.put_start_cmd(1,crc_calcul);
              sdio_builder.put_cmd_number(cmd_number,crc_calcul);
              data_transfer_2 = switch_data_transfer(cmd_number,CMD_mode);
              R_type = switch_cmd_rsp(cmd_number, CMD_mode);
              sdio_builder.put_rand_cmd_bit(32, crc_calcul);
              sdio_builder.put_crc7(crc_calcul);
              sdio_builder.put_end_cmd();
              crc_calcul = [];
              CMD_mode = 0;
          }
          else
          {
              if (cmd_number == 12 || cmd_number == 52)
              {
                  // Do nothing
              }
              else
              {
                  sdio_builder.put_silence(silence_period);
              }
              // sdio_builder.put_silence(silence_period);
              sdio_builder.put_start_cmd(1,crc_calcul);
              sdio_builder.put_cmd_number(cmd_number,crc_calcul);
              data_transfer_2 = switch_data_transfer(cmd_number,CMD_mode);
              R_type = switch_cmd_rsp(cmd_number, CMD_mode);
              if (cmd_number == 55)
              {
                  CMD_mode = 1;
              }
              switch (cmd_number)
              {
                  case 7 :
                  case 9 :
                  case 10:
                  case 15:
                  case 55:
                  {
                      sdio_builder.put_cmd_bits(RCA,16, crc_calcul);
                      sdio_builder.put_cmd_bits(0, 16, crc_calcul);
                      rng = Math.floor(Math.random()*2);
                      if (rng == 1)
                      {
                          transfer = "operation complete";
                      }
                      else
                      {
                          transfer = "operation not complete";
                      }
                      break;
                  }
                  case 52 :
                  {
                      sdio_builder.put_cmd_bits(1, 1, crc_calcul); // R/W
                      sdio_builder.put_cmd_bits(0, 3, crc_calcul); // function number
                      sdio_builder.put_cmd_bits(1, 1, crc_calcul); // RAW
                      sdio_builder.put_cmd_bits(0, 1, crc_calcul); // Stuff
                      sdio_builder.put_cmd_bits(6, 17, crc_calcul); // Register adress
                      sdio_builder.put_cmd_bits(0, 1, crc_calcul); // Stuff
                      sdio_builder.put_cmd_bits(0, 8, crc_calcul); // Write
                      break;
                  }
                  case 53 :
                  {
                      sdio_builder.put_cmd_bits(1, 1, crc_calcul); // R/W
                      sdio_builder.put_cmd_bits(0, 3, crc_calcul); // function number
                      sdio_builder.put_cmd_bits(1, 1, crc_calcul); // Block mode
                      sdio_builder.put_cmd_bits(1, 1, crc_calcul); // OP Code
                      sdio_builder.put_cmd_bits(17, 17, crc_calcul); // Register adress
                      sdio_builder.put_cmd_bits(1, 9, crc_calcul); // Block/Byte Count : 1
                      break;
                  }
                  default :
                  {
                      sdio_builder.put_rand_cmd_bit(32,crc_calcul);
                      break;
                  }
              }
              sdio_builder.put_crc7(crc_calcul);
              sdio_builder.put_end_cmd();
              crc_calcul = [];
          }
      }
  }

}//end on on_build_demo_signals

//Builder object that can be shared to other scripts
ScanaStudio.BuilderObject =
{
    put_bit : function(channel, cmd_or_dat) //channel is an array of the different channel (CMD,DAT0-3)
    {
        var sample_mult = 1;
        if (this.ddr_mode == true && cmd_or_dat != 1 /* we create data bits */) // When we create data bits if we're in DDR50 mode, the bits last half_clock_sample
        {
            sample_mult = 0.5;
        }
        if (channel.length == 2) // channel[0] = CMD; channel[1] = DAT0
        {
            cmd_bit_lvl = channel[0];
            dat0_bit_lvl = channel[1];
            var rng_sample_low = 0;
            var rng_sample_high = 0;
            // var rng_sample_low  = Math.floor((Math.random()*(CONST_t_clk_fall_max + CONST_t_clk_fall_min) - CONST_t_clk_fall_min)/ScanaStudio.builder_get_sample_rate());
            // var rng_sample_high = Math.floor((Math.random()*(CONST_t_clk_rise_max + CONST_t_clk_rise_min) - CONST_t_clk_rise_min)/ScanaStudio.builder_get_sample_rate());
            var nbr_sample_clock_low = this.samples_per_clock/2 + rng_sample_low;
            var nbr_sample_clock_high = this.samples_per_clock/2 + rng_sample_high;
            ScanaStudio.builder_add_samples(this.ch_cmd,channel[0],(nbr_sample_clock_low + nbr_sample_clock_high)*sample_mult);
            ScanaStudio.builder_add_samples(this.ch_clk,0,nbr_sample_clock_low);
            ScanaStudio.builder_add_samples(this.ch_clk,1,nbr_sample_clock_high);
            ScanaStudio.builder_add_samples(this.ch_dat0,channel[1],(nbr_sample_clock_low + nbr_sample_clock_high)*sample_mult);
        }
        else if (channel.length == 5) // channel[0] = CMD; channel[1] = DAT0 ; channel[2] = DAT1 ; channel[3] = DAT2 ; channel[4] = DAT3
        {
            cmd_bit_lvl = channel[0];
            dat0_bit_lvl = channel[1];
            dat1_bit_lvl = channel[2];
            dat2_bit_lvl = channel[3];
            dat3_bit_lvl = channel[4];
            var rng_sample_low = 0;
            var rng_sample_high = 0;
            // var rng_sample_low  = Math.floor((Math.random()*(CONST_t_clk_fall_max + CONST_t_clk_fall_min) - CONST_t_clk_fall_min)/ScanaStudio.builder_get_sample_rate());
            // var rng_sample_high = Math.floor((Math.random()*(CONST_t_clk_rise_max + CONST_t_clk_rise_min) - CONST_t_clk_rise_min)/ScanaStudio.builder_get_sample_rate());
            var nbr_sample_clock_low = this.samples_per_clock/2 + rng_sample_low;
            var nbr_sample_clock_high = this.samples_per_clock/2 + rng_sample_high;
            ScanaStudio.builder_add_samples(this.ch_cmd,cmd_bit_lvl,(nbr_sample_clock_low + nbr_sample_clock_high)*sample_mult);
            ScanaStudio.builder_add_samples(this.ch_clk,0,nbr_sample_clock_low );
            ScanaStudio.builder_add_samples(this.ch_clk,1,nbr_sample_clock_high);
            ScanaStudio.builder_add_samples(this.ch_dat0,dat0_bit_lvl,(nbr_sample_clock_low + nbr_sample_clock_high)*sample_mult);
            ScanaStudio.builder_add_samples(this.ch_dat1,dat1_bit_lvl,(nbr_sample_clock_low + nbr_sample_clock_high)*sample_mult);
            ScanaStudio.builder_add_samples(this.ch_dat2,dat2_bit_lvl,(nbr_sample_clock_low + nbr_sample_clock_high)*sample_mult);
            ScanaStudio.builder_add_samples(this.ch_dat3,dat3_bit_lvl,(nbr_sample_clock_low + nbr_sample_clock_high)*sample_mult);
        }
    },

    put_cmd_bits : function(value, nbits, array)
    {
        var tab = [];
        for (n=nbits-1; n>=0; n--)
        {
            tab.push((value>>n)&0x1);
        }
        if (this.dat_mode == 0)
        {
            for (i=0; i<nbits; i++)
            {
                var channel = [tab[i],1];
                this.put_bit(channel,1);
                array.push(tab[i]);
            }
        }
        else
        {
            for (i=0; i<nbits; i++)
            {
                var channel = [tab[i],1,1,1,1];
                this.put_bit(channel,1);
                array.push(tab[i]);
            }
        }
        return tab;
    },

    put_rand_cmd_bit : function(nbits,array)
    {
        var lvl;
        if (this.dat_mode == 0)
        {
            for (n = 0; n < nbits; n++)
            {
                lvl = Math.floor(Math.random()*2);
                var channel = [lvl,1];
                this.put_bit(channel,1);
                array.push(lvl);
            }
        }
        else
        {
            for (i = 0; i < nbits; i++)
            {
                lvl = Math.floor(Math.random()*2);
                var channel = [lvl,1,1,1,1];
                this.put_bit(channel,1);
                array.push(lvl);
            }
        }
    },

    put_data_bits : function (value,nbits, array)
    {
        var tab = [];
        for (n=nbits-1; n>=0; n--)
        {
            tab.push((value>>n)&0x1);
        }
        var channel = [];
        if (this.dat_mode == 0) // 1 DAT channel
        {
            for (i = 0; i < nbits; i++)
            {
                channel = [1, tab[i]];
                this.put_bit(channel,0);
                array.push(tab[i]);
            }
        }
        else // 4 DAT channel
        {
            for (i = 0; i < nbits/4; i++)
            {
                channel = [1, tab[i*4 + 3], tab[i*4 + 2], tab[i*4 + 1], tab[i*4]]; //channel [cmd,dat0, dat1, dat2, dat3]
                this.put_bit(channel,0);
                array.push(tab[i*4]);
                array.push(tab[i*4 + 1]);
                array.push(tab[i*4 + 2]);
                array.push(tab[i*4 + 3]);
            }
        }
    },

    put_rand_data_bit : function(nbits,array)
    {
        var lvl;
        var channel = [];
        if (this.dat_mode == 0) // 1 DAT channel
        {
            for (i = 0; i < nbits; i++)
            {
                lvl = Math.floor(Math.random()*2);
                channel = [1, lvl];
                this.put_bit(channel,0);
                array.push(lvl);
            }
        }
        else // 4 DAT channel
        {
            for (i = 0; i < nbits/4; i++)
            {
                lvl_1 = Math.floor(Math.random()*2); //DAT0
                lvl_2 = Math.floor(Math.random()*2); //DAT1
                lvl_3 = Math.floor(Math.random()*2); //DAT2
                lvl_4 = Math.floor(Math.random()*2); //DAT3
                channel = [1, lvl_1, lvl_2, lvl_3, lvl_4];
                this.put_bit(channel,0);
                array.push(lvl_4);
                array.push(lvl_3);
                array.push(lvl_2);
                array.push(lvl_1);
            }
        }
    },


    put_start_cmd : function(transmitter,array)
    {
        if (this.dat_mode == 0)
        {
            var channel = [0,1];
            this.put_bit(channel,1);
            array.push(0);
            channel = [transmitter,1];
            this.put_bit(channel,1);
            array.push(transmitter);
        }
        else
        {
            var channel = [0,1,1,1,1];
            this.put_bit(channel,1);
            array.push(0);
            channel = [transmitter,1,1,1,1];
            this.put_bit(channel,1);
            array.push(transmitter);
        }
    },

    put_start_data : function()
    {
        var channel = [];
        if (this.dat_mode == 0) // 1 DAT channel
        {
            var channel = [1,0];
        }
        else // 4 DAT channel
        {
            var channel = [1,0,0,0,0];
        }
        this.put_bit(channel,0);
    },

    put_cmd_number : function(number,array)
    {
        var tab = [];
        var n;

        for (n = 5; n >= 0 ; n--)
        {
            tab.push((number>>n)&0x1);
        }

        if (this.dat_mode == 0)
        {
            for (i=0; i<6; i++)
            {
                var channel = [tab[i],1];
                this.put_bit(channel,1);
                array.push(tab[i]);
            }
        }
        else
        {
            for (i=0; i<6; i++)
            {
                var channel = [tab[i],1,1,1,1];
                this.put_bit(channel,1);
                array.push(tab[i]);
            }
        }
        return number;
    },

    put_rand_cmd_number : function(array)
    {
        var tab = [];
        var n;
        var number = Math.floor(Math.random()*63);
        for (n = 5; n >= 0 ; n--)
        {
            tab.push((number>>n)&0x1);
        }
        if (this.dat_mode == 0)
        {
            for (i=0; i<6; i++)
            {
                var channel = [tab[i],1];
                this.put_bit(channel,1);
                array.push(tab[i]);
            }
        }
        else
        {
            for (i=0; i<6; i++)
            {
                var channel = [tab[i],1,1,1,1];
                this.put_bit(channel,1);
                array.push(tab[i]);
            }
        }

        return number;
    },

    put_crc7 : function(bit_array) //data is an array of n bits (40 or 128 for R2)
    {
        // Transform the bits array into byte array
        var byte_array = [];
        var dec = 0;
        for (j=0; j<bit_array.length/8; j++)
        {
            for (i=0; i<8; i++)
            {
                dec += bit_array[(j*8)+i]*Math.pow(2,7-i);
            }
            byte_array.push(dec);
            dec = 0;
        }
        // generate a table value for all 256 possible byte values
        var i, j;
        var CRC7Poly = 0x89;

        for (i = 0; i < 256; i++)
        {
            this.CRCTable[i] = (i & 0x80) ? i ^ CRC7Poly : i;
            for (j = 1; j < 8; j++)
            {
                this.CRCTable[i] <<= 1;
                if (this.CRCTable[i] & 0x80)
                    this.CRCTable[i] ^= CRC7Poly;
            }
        }
        // returns the CRC-7 for a message of "length" bytes
        var CRC7 = 0;

        for (i = 0; i < byte_array.length; i++)
        {
            CRC7 = this.CRCTable[(CRC7 << 1) ^ byte_array[i]];
        }
        // Put the corresponding bits with put_bit
        var tab =[];
        for (n = 6; n >= 0 ; n--)
        {
            tab.push((CRC7>>n)&0x1);
        }
        if (this.dat_mode == 0)
        {
            for (i=0; i<7; i++)
            {
                var channel = [tab[i],1];
                this.put_bit(channel,1);
            }
        }
        else
        {
            for (i=0; i<7; i++)
            {
                var channel = [tab[i],1,1,1,1];
                this.put_bit(channel,1);
            }
        }

    },

    put_crc16 : function(bit_array) // get the crc16 for data channels, this function take an array of n bits and create the corresponding crc16
    {
        if (this.dat_mode == 0) //1 DAT channel_length
        {
            // Transform the bits array into byte array
            var dat_0_byte_array = [];
            var dec = 0;
            for (j=0; j<bit_array.length/8; j++)
            {
                for (i=0; i<8; i++)
                {
                    dec += bit_array[(j*8)+i]*Math.pow(2,7-i);
                }
                dat_0_byte_array.push(dec);
                dec = 0;
            }
            // returns the CRC-16 for a message of "length" bytes
            var POLY = 0x1021, INIT = 0, XOROUT = 0;
            for(var crc = INIT, i = 0; i < dat_0_byte_array.length; i++)
            {
                crc = crc ^ (dat_0_byte_array[i] << 8);
                for (var j = 0; j < 8; j++)
                {
                    crc = crc & 0x8000 ? crc << 1 ^ POLY : crc << 1;
                }
            }
            var CRC16 = (crc ^ XOROUT) & 0xFFFF;
            // Put the corresponding bits with put_bit
            var CRC16_dat0 =[];
            for (n = 15; n >= 0 ; n--)
            {
                CRC16_dat0.push((CRC16>>n)&0x1);
            }
            for (i=0; i<16; i++)
            {
                var channel = [1,CRC16_dat0[i]];
                this.put_bit(channel,0);
            }
        }
        else
        {
            // Transform the bits array into byte array
            var dat_0_byte_array = [];
            var dat_1_byte_array = [];
            var dat_2_byte_array = [];
            var dat_3_byte_array = [];
            var dec = 0;

            for (j=0; j<bit_array.length/(8*4); j++) //DAT3
            {
                for (i=0; i<8; i++)
                {
                    dec += bit_array[(j*8*4)+i*4]*Math.pow(2,7-i);
                }
                dat_3_byte_array.push(dec);
                dec = 0;
            }

            // returns the CRC-16 for a message of "length" bytes
            var POLY = 0x1021, INIT = 0, XOROUT = 0;
            for(var crc = INIT, i = 0; i < dat_3_byte_array.length; i++)
            {
                crc = crc ^ (dat_3_byte_array[i] << 8);
                for (var j = 0; j < 8; j++)
                {
                    crc = crc & 0x8000 ? crc << 1 ^ POLY : crc << 1;
                }
            }
            CRC16 = (crc ^ XOROUT) & 0xFFFF;

            var CRC16_dat3 =[];
            for (n = 15; n >= 0 ; n--)
            {
                CRC16_dat3.push((CRC16>>n)&0x1);
            }

            for (j=0; j<bit_array.length/(8*4); j++) //DAT2
            {
                for (i=0; i<8; i++)
                {
                    dec += bit_array[(j*8*4) + (i*4) + 1]*Math.pow(2,7-i);
                }
                dat_2_byte_array.push(dec);
                dec = 0;
            }

            // returns the CRC-16 for a message of "length" bytes
            var POLY = 0x1021, INIT = 0, XOROUT = 0;
            for(var crc = INIT, i = 0; i < dat_2_byte_array.length; i++)
            {
                crc = crc ^ (dat_2_byte_array[i] << 8);
                for (var j = 0; j < 8; j++)
                {
                    crc = crc & 0x8000 ? crc << 1 ^ POLY : crc << 1;
                }
            }
            CRC16 = (crc ^ XOROUT) & 0xFFFF;

            var CRC16_dat2 =[];
            for (n = 15; n >= 0 ; n--)
            {
                CRC16_dat2.push((CRC16>>n)&0x1);
            }

            for (j=0; j<bit_array.length/(8*4); j++) //DAT1
            {
                for (i=0; i<8; i++)
                {
                    dec += bit_array[(j*8*4) + (i*4) + 2]*Math.pow(2,7-i);
                }
                dat_1_byte_array.push(dec);
                dec = 0;
            }
            // returns the CRC-16 for a message of "length" bytes
            var POLY = 0x1021, INIT = 0, XOROUT = 0;
            for(var crc = INIT, i = 0; i < dat_1_byte_array.length; i++)
            {
                crc = crc ^ (dat_1_byte_array[i] << 8);
                for (var j = 0; j < 8; j++)
                {
                    crc = crc & 0x8000 ? crc << 1 ^ POLY : crc << 1;
                }
            }
            CRC16 = (crc ^ XOROUT) & 0xFFFF;

            var CRC16_dat1 =[];
            for (n = 15; n >= 0 ; n--)
            {
                CRC16_dat1.push((CRC16>>n)&0x1);
            }

            for (j=0; j<bit_array.length/(8*4); j++) //DAT0
            {
                for (i=0; i<8; i++)
                {
                    dec += bit_array[(j*8*4) + (i*4) + 3]*Math.pow(2,7-i);
                }
                dat_0_byte_array.push(dec);
                dec = 0;
            }

            // returns the CRC-16 for a message of "length" bytes
            var POLY = 0x1021, INIT = 0, XOROUT = 0;
            for(var crc = INIT, i = 0; i < dat_0_byte_array.length; i++)
            {
                crc = crc ^ (dat_0_byte_array[i] << 8);
                for (var j = 0; j < 8; j++)
                {
                    crc = crc & 0x8000 ? crc << 1 ^ POLY : crc << 1;
                }
            }
            CRC16 = (crc ^ XOROUT) & 0xFFFF;

            var CRC16_dat0 =[];
            for (n = 15; n >= 0 ; n--)
            {
                CRC16_dat0.push((CRC16>>n)&0x1);
            }
            for (c=0; c<16; c++)
            {
                var channel = [1,CRC16_dat0[c],CRC16_dat1[c],CRC16_dat2[c],CRC16_dat3[c]];
                this.put_bit(channel,0);
            }
        }
    },

    put_end_cmd : function()
    {
        if (this.dat_mode == 1)
        {
            var channel = [1,1,1,1,1];
        }
        else
        {
            var channel = [1,1];
        }
        this.put_bit(channel,1);
    },

    put_end_data : function()
    {
        if (this.dat_mode == 1)
        {
            var channel = [1,1,1,1,1];
        }
        else
        {
            var channel = [1,1];
        }
        this.put_bit(channel,0);
    },

    put_silence : function(s)
    {
        sample_per_clock = this.samples_per_clock;
        if (this.dat_mode == 1)
        {
            var channel = [1,1,1,1,1];
        }
        else
        {
            var channel = [1,1];
        }
        for(i=0; i<s/sample_per_clock; i++)
        {
            this.put_bit(channel,1);
        }
    },


    config : function(ch_cmd,ch_clk,ch_dat0,ch_dat1,ch_dat2,ch_dat3,frequency,ddr_mode, dat_mode)
    {
        this.ch_cmd = ch_cmd;
        this.ch_clk = ch_clk;
        this.ch_dat0 = ch_dat0;
        this.ch_dat1 = ch_dat1;
        this.ch_dat2 = ch_dat2;
        this.ch_dat3 = ch_dat3;
        this.samples_per_clock = ScanaStudio.builder_get_sample_rate() / (frequency);
        this.CRCTable = [];
        this.ddr_mode = ddr_mode;
        this.dat_mode = dat_mode;
    },


    GenerateCRCTable : function(CRCPoly)
    {
        var i, j;

        // generate a table value for all 256 possible byte values
        for (i = 0; i < 256; i++)
        {
            this.CRCTable[i] = (i & 0x80) ? i ^ CRCPoly : i;
            for (j = 1; j < 8; j++)
            {
                this.CRCTable[i] <<= 1;
                if (this.CRCTable[i] & 0x80)
                    this.CRCTable[i] ^= CRCPoly;
            }
        }
    },

};//end BuilderObject


//-------------------------------------------------------------------------------------------
//Some useful functions

/*  A helper function add leading "0"s to numbers
      Parameters
        * num_str: A string of the number to be 0-padded
        * size: The total wanted size of the output string
*/
function pad(num_str, size) {
    while (num_str.length < size) num_str = "0" + num_str;
    return num_str;
}

// Used to change the item content string accordly to the GUI
function add_sdio_usual_data_item(ch, sdio_simple, nbits, crc_calcul) // Used to read Usual Data (MSB)
{
    var content,b;
    var n_hex_bytes = Math.ceil(sdio_simple.valid_bits / 8);
    var hex_val;
    var prev_content = "";
    var value;
    var nb_dat_ch = ch.length;
    var item_start_stop_array = [];
    var bit_array = [];
    var item_display = [];
    for (q=0; q<nb_dat_ch; q++)
    {
            value = Number(sdio_simple.unsigned_words[q]);
            item_display = fill_item_array(value, nbits, bit_array);
            if ((q != 3) && (nb_dat_ch != 1))
            {
                dec_item_new_v2(ch[q],sdio_simple);
                display_sample_0_1(sdio_simple,item_display);
                ScanaStudio.dec_item_end();
            }
    }
    var item_display_2 = [];
    if (ch.length != 1)
    {
        for (m=0; m<nbits; m++)
        {
            item_display_2.push(bit_array[m]);
            item_display_2.push(bit_array[m+nbits]);
            item_display_2.push(bit_array[m+nbits*2]);
            item_display_2.push(bit_array[m+nbits*3]);
        }
        value = bin2dec(item_display_2, nbits*ch.length);
        crc_pre_calcul(value, 8, crc_calcul);
    }
    else
    {
        value = bin2dec(bit_array, nbits*ch.length);
        crc_pre_calcul(value, nbits, crc_calcul);
    }

    if (hexview_endianness == 0)
    {
        hex_val = (value >> ((n_hex_bytes -1 - b)*8) & 0xFF);
    }
    else
    {
        hex_val = (value >> b*8) & 0xFF;
    }

    item_start_stop_array = dec_item_new_v2 (ch_dat0, sdio_simple);
    ScanaStudio.hex_view_add_byte(ch_dat0,item_start_stop_array[0], item_start_stop_array[1] ,hex_val);
    if (ScanaStudio.is_pre_decoding())
    {
        //in case tbis decoder is called by another decoder,
        //provide data in a way that can be easily interpreted
        //by the parent decoder.
        content = "0x" + pad(value.toString(16),Math.ceil(sdio_simple.valid_bits/4));
        ScanaStudio.dec_item_add_content(content);
    }
    else
    {
        content = "";
        if (format_hex)
        {
            content += "0x" + pad(value.toString(16),Math.ceil(sdio_simple.valid_bits/4));
        }
        if (format_ascii)
        {
            content += " '" + String.fromCharCode(value) + "'";
        }
        if (format_dec)
        {
            content += " (" + value.toString(10) + ")";
        }
        if (format_bin)
        {
            content += " 0b" + pad(value.toString(2),sdio_simple.valid_bits) ;
        }
        ScanaStudio.dec_item_add_content(content);
        // Packet View
        ScanaStudio.packet_view_add_packet(false,ch_dat0,sdio_simple.start_sample,sdio_simple.end_sample,
            "Data",content,ScanaStudio.PacketColors.Data.Title,ScanaStudio.PacketColors.Data.Content);
        //Add a smaller version of the content field
        content = "";
        if  ((format_hex) && (content == ""))
        {
            content += "0x" + pad(value.toString(16),Math.ceil(sdio_simple.valid_bits/4));
        }
        if ((format_ascii) && (content == ""))
        {
            content += " " + String.fromCharCode(value);
        }
        if ((format_dec) && (content == ""))
        {
            content += " " + value.toString(10) ;
        }
        if ((format_bin) && (content == ""))
        {
            content += " 0b" + pad(value.toString(2),sdio_simple.valid_bits);
        }
    ScanaStudio.dec_item_add_content(content);
    display_sample_0_1(sdio_simple,item_display);
    ScanaStudio.dec_item_end();
    }
}

// Used to change the item content string accordly to the GUI
function add_sdio_wide_width_data_item(ch, sdio_simple, nbits, crc_calcul) // Used to read Wide Width Data (MSB)
{
    var content,b;
    var n_hex_bytes = Math.ceil(sdio_simple.valid_bits / 8);
    var hex_val;
    var prev_content = "";
    var value;
    var nb_dat_ch = ch.length;
    var item_start_stop_array = [];
    var bit_array = [];
    var item_display = [];
    for (q=0; q<nb_dat_ch; q++)
    {
            value = Number(sdio_simple.unsigned_words[q]);
            item_display = fill_item_array(value, nbits, bit_array);
            if ((q != 3) && (nb_dat_ch != 1))
            {
                dec_item_new_v2(ch[q],sdio_simple);
                display_sample_0_1(sdio_simple,item_display);
                ScanaStudio.dec_item_end();
            }
    }
    var item_display_2 = [];
    if (ch.length != 1)
    {
        for (m=0; m<nbits; m++)
        {
            item_display_2.push(bit_array[m]);
            item_display_2.push(bit_array[m+nbits]);
            item_display_2.push(bit_array[m+nbits*2]);
            item_display_2.push(bit_array[m+nbits*3]);
        }
        value = bin2dec(item_display_2, nbits*ch.length);
        crc_pre_calcul(value, nbits*ch.length, crc_calcul);
    }
    else
    {
        value = bin2dec(bit_array, nbits*ch.length);
        crc_pre_calcul(value, nbits, crc_calcul);
    }

    if (hexview_endianness == 0)
    {
        hex_val = (value >> ((n_hex_bytes -1 - b)*8) & 0xFF);
    }
    else
    {
        hex_val = (value >> b*8) & 0xFF;
    }
    item_start_stop_array = dec_item_new_v2 (ch_dat0, sdio_simple);
    ScanaStudio.hex_view_add_byte(ch_dat0,item_start_stop_array[0], item_start_stop_array[1] ,hex_val);
    display_sample_0_1(sdio_simple,item_display);
    return value;
}

// Used to change the item content string accordly to the GUI
function add_CMD19_data(ch, sdio_simple, nbits, crc_calcul)
{
    var content,b;
    var n_hex_bytes = Math.ceil(sdio_simple.valid_bits / 8);
    var hex_val;
    var prev_content = "";
    var value;
    var nb_dat_ch = ch.length;
    var item_start_stop_array = [];
    var bit_array = [];
    var item_display = [];
    for (q=0; q<nb_dat_ch; q++)
    {
        value = Number(sdio_simple.unsigned_words[q]);
        item_display = fill_item_array(value, nbits, bit_array);
        dec_item_new_v2(ch[q],sdio_simple);
        ScanaStudio.dec_item_add_content("0h" +  (pad(value.toString(16),nbits/4)))
        display_sample_0_1(sdio_simple,item_display);
        ScanaStudio.dec_item_end();
        packet_string = "0h" +  (pad(value.toString(16),nbits/4));
        // Packet View
        packet_view_add_packet_v2(ch, sdio_simple, "Tunning Pattern", packet_string, "Data");
    }
    var item_display_2 = [];
    for (m=0; m<nbits; m++)
    {
        item_display_2.push(bit_array[m]);
        item_display_2.push(bit_array[m+nbits]);
        item_display_2.push(bit_array[m+nbits*2]);
        item_display_2.push(bit_array[m+nbits*3]);
    }
    for(c=0; c<item_display_2.length; c++)
    {
        crc_calcul.push(item_display_2[c]);
    }

    return value;
}

// Used for packet view, automately put the right Colors accordly to the types and change the data string item accordly to the GUI
function packet_view_add_packet_v2 (ch,sdio_simple,title,content,types)
{
    if (ch != ch_cmd)
    {
            value = Number(sdio_simple.unsigned_words);
            content = "";
            if (format_hex)
            {
                content += "0x" + pad(value.toString(16),2);
            }
            if (format_ascii)
            {
                content += " '" + String.fromCharCode(value) + "'";
            }
            if (format_dec)
            {
                content += " (" + value.toString(10) + ")";
            }
            if (format_bin)
            {
                content += " 0b" + pad(value.toString(2),sdio_simple.valid_bits) ;
            }
    }
    if (Array.isArray(ch) == true)
    {
        for (i=0; i<ch.length; i++)
        {
            value = Number(sdio_simple.unsigned_words[i]);
            content = "";
            if (format_hex)
            {
                content += "0x" + pad(value.toString(16),2);
            }
            if (format_ascii)
            {
                content += " '" + String.fromCharCode(value) + "'";
            }
            if (format_dec)
            {
                content += " (" + value.toString(10) + ")";
            }
            if (format_bin)
            {
                content += " 0b" + pad(value.toString(2),sdio_simple.valid_bits) ;
            }
            switch (types)
            {
                case "Wrap" :
                {
                    ScanaStudio.packet_view_add_packet(false,
                    ch[i],
                    sdio_simple.start_sample,
                    sdio_simple.end_sample,
                    title,
                    content,
                    ScanaStudio.PacketColors.Wrap.Title,
                    ScanaStudio.PacketColors.Wrap.Content);
                    break;
                }
                case "Head" :
                {
                    ScanaStudio.packet_view_add_packet(false,
                    ch[i],
                    sdio_simple.start_sample,
                    sdio_simple.end_sample,
                    title,
                    content,
                    ScanaStudio.PacketColors.Head.Title,
                    ScanaStudio.PacketColors.Head.Content);
                    break;
                }
                case "Preamble" :
                {
                    ScanaStudio.packet_view_add_packet(false,
                    ch[i],
                    sdio_simple.start_sample,
                    sdio_simple.end_sample,
                    title,
                    content,
                    ScanaStudio.PacketColors.Preamble.Title,
                    ScanaStudio.PacketColors.Preamble.Content);
                    break;
                }
                case "Data" :
                {
                    ScanaStudio.packet_view_add_packet(false,
                    ch[i],
                    sdio_simple.start_sample,
                    sdio_simple.end_sample,
                    title,
                    content,
                    ScanaStudio.PacketColors.Data.Title,
                    ScanaStudio.PacketColors.Data.Content);
                    break;
                }
                case "Check" :
                {
                    ScanaStudio.packet_view_add_packet(false,
                    ch[i],
                    sdio_simple.start_sample,
                    sdio_simple.end_sample,
                    title,
                    content,
                    ScanaStudio.PacketColors.Check.Title,
                    ScanaStudio.PacketColors.Check.Content);
                    break;
                }
                case "Error" :
                {
                    ScanaStudio.packet_view_add_packet(false,
                    ch[i],
                    sdio_simple.start_sample,
                    sdio_simple.end_sample,
                    title,
                    content,
                    ScanaStudio.PacketColors.Error.Title,
                    ScanaStudio.PacketColors.Error.Content);
                    break;
                }
                case "Misc" :
                {
                    ScanaStudio.packet_view_add_packet(false,
                    ch[i],
                    sdio_simple.start_sample,
                    sdio_simple.end_sample,
                    title,
                    content,
                    ScanaStudio.PacketColors.Misc.Title,
                    ScanaStudio.PacketColors.Misc.Content);
                    break;
                }
            }
        }
    }
    else
    {
        switch (types)
        {
            case "Wrap" :
            {
                ScanaStudio.packet_view_add_packet(false,
                    ch,
                    sdio_simple.start_sample,
                    sdio_simple.end_sample,
                    title,
                    content,
                    ScanaStudio.PacketColors.Wrap.Title,
                    ScanaStudio.PacketColors.Wrap.Content);
                    break;
            }
            case "Head" :
            {
                ScanaStudio.packet_view_add_packet(false,
                ch,
                sdio_simple.start_sample,
                sdio_simple.end_sample,
                title,
                content,
                ScanaStudio.PacketColors.Head.Title,
                ScanaStudio.PacketColors.Head.Content);
                break;
            }
            case "Preamble" :
            {
                ScanaStudio.packet_view_add_packet(false,
                ch,
                sdio_simple.start_sample,
                sdio_simple.end_sample,
                title,
                content,
                ScanaStudio.PacketColors.Preamble.Title,
                ScanaStudio.PacketColors.Preamble.Content);
                break;
            }
            case "Data" :
            {
                ScanaStudio.packet_view_add_packet(false,
                ch,
                sdio_simple.start_sample,
                sdio_simple.end_sample,
                title,
                content,
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
                break;
            }
            case "Check" :
            {
                ScanaStudio.packet_view_add_packet(false,
                ch,
                sdio_simple.start_sample,
                sdio_simple.end_sample,
                title,
                content,
                ScanaStudio.PacketColors.Check.Title,
                ScanaStudio.PacketColors.Check.Content);
                break;
            }
            case "Error" :
            {
                ScanaStudio.packet_view_add_packet(false,
                ch,
                sdio_simple.start_sample,
                sdio_simple.end_sample,
                title,
                content,
                ScanaStudio.PacketColors.Error.Title,
                ScanaStudio.PacketColors.Error.Content);
                break;
            }
            case "Misc" :
            {
                ScanaStudio.packet_view_add_packet(false,
                ch,
                sdio_simple.start_sample,
                sdio_simple.end_sample,
                title,
                content,
                ScanaStudio.PacketColors.Misc.Title,
                ScanaStudio.PacketColors.Misc.Content);
                break;
            }
        }
    }
}

// Used for packet view, automately put the right Colors accordly to the types and change the data string item accordly to the GUI
function packet_view_add_wide_width_packet(ch,sdio_simple,title,content,types)
{

    switch (types)
    {
        case "Wrap" :
        {
            ScanaStudio.packet_view_add_packet(false,
                ch,
                sdio_simple.start_sample,
                sdio_simple.end_sample,
                title,
                content,
                ScanaStudio.PacketColors.Wrap.Title,
                ScanaStudio.PacketColors.Wrap.Content);
                break;
        }
        case "Head" :
        {
            ScanaStudio.packet_view_add_packet(false,
            ch,
            sdio_simple.start_sample,
            sdio_simple.end_sample,
            title,
            content,
            ScanaStudio.PacketColors.Head.Title,
            ScanaStudio.PacketColors.Head.Content);
            break;
        }
        case "Preamble" :
        {
            ScanaStudio.packet_view_add_packet(false,
            ch,
            sdio_simple.start_sample,
            sdio_simple.end_sample,
            title,
            content,
            ScanaStudio.PacketColors.Preamble.Title,
            ScanaStudio.PacketColors.Preamble.Content);
            break;
        }
        case "Data" :
        {
            ScanaStudio.packet_view_add_packet(false,
            ch,
            sdio_simple.start_sample,
            sdio_simple.end_sample,
            title,
            content,
            ScanaStudio.PacketColors.Data.Title,
            ScanaStudio.PacketColors.Data.Content);
            break;
        }
        case "Check" :
        {
            ScanaStudio.packet_view_add_packet(false,
            ch,
            sdio_simple.start_sample,
            sdio_simple.end_sample,
            title,
            content,
            ScanaStudio.PacketColors.Check.Title,
            ScanaStudio.PacketColors.Check.Content);
            break;
        }
        case "Error" :
        {
            ScanaStudio.packet_view_add_packet(false,
            ch,
            sdio_simple.start_sample,
            sdio_simple.end_sample,
            title,
            content,
            ScanaStudio.PacketColors.Error.Title,
            ScanaStudio.PacketColors.Error.Content);
            break;
        }
        case "Misc" :
        {
            ScanaStudio.packet_view_add_packet(false,
            ch,
            sdio_simple.start_sample,
            sdio_simple.end_sample,
            title,
            content,
            ScanaStudio.PacketColors.Misc.Title,
            ScanaStudio.PacketColors.Misc.Content);
            break;
        }
    }
}

// Function used to create the demo signal

// Create a rng cmd between the 7 ACMD
function switch_acmd(rng_cmd)
{
    var cmd;
    switch(rng_cmd)
    {

        case 0 :
        {
            return cmd = 6;
            break;
        }
        case 1 :
        {
            return cmd = 13;
            break;
        }
        case 2 :
        {
            return cmd = 22;
            break;
        }
        case 3 :
        {
            return cmd = 23;
            break;
        }
        case 4 :
        {
            return cmd = 41;
            break;
        }
        case 5 :
        {
            return cmd = 42;
            break;
        }
        case 6 :
        {
            return cmd = 51;
            break;
        }
    }
}

// Create a rng cmd between the non initialization CMD
function switch_cmd(rng_cmd)
{
    var cmd;
    switch(rng_cmd)
    {

        case 0 :
        {
            return cmd = 6;
            break;
        }
        case 1 :
        {
            return cmd = 13;
            break;
        }
        case 2 :
        {
            return cmd = 22;
            break;
        }
        case 3 :
        {
            return cmd = 23;
            break;
        }
        case 4 :
        {
            return cmd = 41;
            break;
        }
        case 5 :
        {
            return cmd = 42;
            break;
        }
        case 6 :
        {
            return cmd = 51;
            break;
        }
    }
}

// Used to know if the CMD will lead to a data transfer
function switch_data_transfer(CMD,CMD_mode)
{
    switch(Number(CMD))
    {
        case 6  :
        case 17 :
        case 18 :
        case 19 :
        case 24 :
        case 25 :
        case 27 :
        case 30 :
        case 40 :
        case 46 :
        case 47 :
        case 48 :
        case 49 :
        case 53 :
        case 56 :
        case 58 :
        case 59 :
        {
            if (Number(CMD) == 6)
            {
                if (Number(CMD_mode) == 1)
                {
                    return data_transfer = false;
                }
            }
            return data_transfer = true;
        } //end case 6/17/18/19/24/25/27/30/40/46/47/48/49/56/58/59
        case 13 :
        case 22 :
        case 51 :
        {
            if(CMD_mode == 1)
            {
                return data_transfer = true;
            }
            break;
        }
        default :
        {
            return data_transfer = false;
        }
    }//end second switch (Number(CMD))
}

function switch_nb_data_bits(CMD,CMD_mode)
{
    switch (Number(CMD))
    {
        case 6 : //CMD 6
        {
            if (CMD_mode == 0)
            {
                return nbits = 512; //Switch Functions Status
            }
        }
        case 13 : //ACMD 13
        {
            if (CMD_mode == 1)
            {
                return nbits = 512; // SD Status
            }
        }
        case 17 : //CMD 17
        {
            return nbits = Block_length*8; // usual data
        }
        case 18 : //CMD 18
        {
            return nbits = Block_length*8; // usual data
        }
        case 19 : //CMD19
        {
            return nbits = 512; // Tunning Pattern
        }
        case 22 : //ACMD 22
        {
            if (CMD_mode == 1)
            {
                return nbits = 32; // Number of the written data block
            }
            break;
        }
        case 24 : //CMD 24
        {
            return nbits = Block_length*8; // usual data
        }
        case 25 : //CMD 25
        {
            return nbits = Block_length*8; // usual data
        }
        case 27 : //CMD 27
        {
            return nbits = 128; // CSD Register
        }
        case 30 : //CMD 30
        {
            return nbits = 32; // Write protection bits
        }
        case 40 : //CMD 40
        {
            return nbits = Block_length*8; // IDK
        }
        case 51 : //ACMD 51
        {
            if (last_CMD_mode == 1)
            {
                return nbits = 64; // SCR Register
            }
            break;
        }
        case 53 : //CMD 53
        {
            return nbits = Block_length*8; // I/O Function
        }
        case 56 : //CMD 56
        {
            return nbits = Block_length*8; // usual data
        }
        default : //
        {
            return nbits = 512*8; // usual data
        }
    }
}


function switch_cmd_rsp(CMD,CMD_mode)
{
    switch (Number(CMD))
    {
        case 2 :
        case 9 :
        case 10 :
        {
            return R_type = "R2";
        }
        case 0  :
        case 6  :
        case 11 :
        case 13 :
        case 16 :
        case 17 :
        case 18 :
        case 19 :
        case 22 :
        case 23 :
        case 24 :
        case 25 :
        case 27 :
        case 30 :
        case 32 :
        case 33 :
        case 42 :
        case 44 :
        case 45 :
        case 46 :
        case 47 :
        case 48 :
        case 49 :
        case 51 :
        case 55 :
        case 56 :
        case 58 :
        case 59 :
        {
            return R_type = "R1";
            break;
        }
        case 7  :
        case 12 :
        case 20 :
        case 28 :
        case 29 :
        case 38 :
        case 43 :
        {
            return R_type = "R1b";
        }
        case 41 :
        {
            if (CMD_mode == 1)
            {
                return R_type = "R3";
            }
            else
            {
                return R_type = "Undefined";
            }
            break;
        }
        case 3 :
        {
            return R_type = "R6";
        }
        case 5 :
        {
            return R_type = "R4"
        }
        case 8 :
        {
            return R_type = "R7";
        }
        case 52 :
        case 53 :
        {
            return R_type = "R5";
        }
        default :
        {
            return R_type = "Undefined";
        }
    }//end first switch (Number(CMD))
}

//-------------------------------------------------------------------------------------------------------------------------------------------------//
// All of these functions are used to the CSD Register

// Used for the CSD Register and especially for the TAAC and TRAN_SPEED
function time_value_switch(time_value) // It's a dec value
{
    var content;
    switch (time_value)
    {
        case 0 :
        {
            return content = "Error";
        }
        case 1 :
        {
            return content = 1.0;
        }
        case 2 :
        {
            return content = 1.2;
        }
        case 3 :
        {
            return content = 1.3;
        }
        case 4 :
        {
            return content = 1.5;
        }
        case 5 :
        {
            return content = 2.0;
        }
        case 6 :
        {
            return content = 2.5;
        }
        case 7 :
        {
            return content = 3.0;
        }
        case 8 :
        {
            return content = 3.5;
        }
        case 9 :
        {
            return content = 4.0;
        }
        case 10 :
        {
            return content = 4.5;
        }
        case 11 :
        {
            return content = 5.0;
        }
        case 12 :
        {
            return content = 5.5;
        }
        case 13 :
        {
            return content = 6.0;
        }
        case 14 :
        {
            return content = 7.0;
        }
        case 15 :
        {
            return content = 8.0;
        }
    }
}


// Used for the TAAC value in the CSD Register
function time_unit_switch(time_unit, time_value, sdio_simple) // Both are Dec value
{
    var content = "";
    if (time_value == "Error")
    {
        return content = "Time value error";
        ScanaStudio.dec_item_emphasize_error();
    }
    switch (time_unit)
    {
        case 0 :
        {
            packet_string = "Data Read access time-1 :" + 1*time_value + "ns";
            types = "Data";
            ScanaStudio.dec_item_add_content("Data Read access time-1 (TAAC) : " + 1*time_value + "ns");
            ScanaStudio.dec_item_add_content("TAAC : " + 1*time_value + "ns");
            break;
        }
        case 1 :
        {
            packet_string = "Data Read access time-1 :" + 10*time_value + "ns";
            types = "Data";
            ScanaStudio.dec_item_add_content("Data Read access time-1 (TAAC) : " + 10*time_value + "ns");
            ScanaStudio.dec_item_add_content("TAAC : " + 10*time_value + "ns");
            break;
        }
        case 2 :
        {
            packet_string = "Data Read access time-1 :" + 100*time_value + "ns";
            types = "Data";
            ScanaStudio.dec_item_add_content("Data Read access time-1 (TAAC) : " + 100*time_value + "ns");
            ScanaStudio.dec_item_add_content("TAAC : " + 100*time_value + "ns");
            break;
        }
        case 3 :
        {
            packet_string = "Data Read access time-1 :" + 1*time_value + "us";
            types = "Data";
            ScanaStudio.dec_item_add_content("Data Read access time-1 (TAAC) : " + 1*time_value + "us");
            ScanaStudio.dec_item_add_content("TAAC : " + 1*time_value + "us");
            break;
        }
        case 4 :
        {
            packet_string = "Data Read access time-1 :" + 10*time_value + "us";
            types = "Data";
            ScanaStudio.dec_item_add_content("Data Read access time-1 (TAAC) : " + 10*time_value + "us");
            ScanaStudio.dec_item_add_content("TAAC : " + 10*time_value + "us");
            break;
        }
        case 5 :
        {
            packet_string = "Data Read access time-1 :" + 100*time_value + "us";
            types = "Data";
            ScanaStudio.dec_item_add_content("Data Read access time-1 (TAAC) : " + 100*time_value + "us");
            ScanaStudio.dec_item_add_content("TAAC : " + 100*time_value + "us");
            break;
        }
        case 6 :
        {
            packet_string = "Data Read access time-1 :" + 1*time_value + "ms";
            types = "Data";
            ScanaStudio.dec_item_add_content("Data Read access time-1 (TAAC) : " + 1*time_value + "ms");
            ScanaStudio.dec_item_add_content("TAAC : " + 1*time_value + "ms");
            break;
        }
        case 7 :
        {
            packet_string = "Data Read access time-1 :" + 10*time_value + "ms";
            types = "Data";
            ScanaStudio.dec_item_add_content("Data Read access time-1 (TAAC) : " + 10*time_value + "ms");
            ScanaStudio.dec_item_add_content("TAAC : " + 10*time_value + "ms");
            break;
        }
    }
    display_sample(sdio_simple);
    ScanaStudio.dec_item_end();
    packet_view_add_packet_v2(ch_cmd,sdio_simple,"TAAC",packet_string,types);
}

// Used for the READ_BL_LEN value in the CSD Register
function BL_LEN(value, CSD_version)
{
    var content = "";
    if (CSD_version == 0)
    {
        switch (Number(value))
        {
            case 9 :
            {
                return content = 512 + "Bytes";
            }
            case 10 :
            {
                return content = 1024 + "Bytes";
            }
            case 11 :
            {
                return content = 2048 + "Bytes";
            }
            default :
            {
                return content = Math.pow(2,value) + "Bytes, is an invalid maximum";
            }
        }
    }
    else
    {
        if (value == 9)
        {
            return content = 512 + "Bytes";
        }
        else
        {
            return content = "In 2.0, WRITE_BL_LEN fixed to 512Bytes";
        }
    }
}

// Used for the TRAN_SPEED value in the CSD Register
function transfer_rate_switch(transfer_rate_unit, time_value) //Both are dec values
{
    var content = "";
    if (time_value == "Error")
    {
        return content = "Error";
        ScanaStudio.dec_item_emphasize_error();
    }
    switch (Number(transfer_rate_unit))
    {
        case 0 :
        {
            return content = 100*time_value + "kbit/s";
        }
        case 1 :
        {
            return content = 1*time_value + "Mbit/s";
        }
        case 2 :
        {
            return content = 10*time_value + "Mbit/s";
        }
        case 3 :
        {
            return content = 100*time_value + "Mbit";
        }
        default :
        {
            return content = "Error Reserved bit should be 0";
        }
    }
}

// CSD Register VDD_CURR_MIN
function VDD_CURR_MIN(value)
{
    var content = "";
    switch(Number(value))
    {
        case 0:
        {
            content = "0.5mA";
        }
        case 1:
        {
            content = "1mA";
        }
        case 2:
        {
            content = "5mA";
        }
        case 3:
        {
            content = "10mA";
        }
        case 4:
        {
            content = "25mA";
        }
        case 5:
        {
            content = "35mA";
        }
        case 6:
        {
            content = "60mA";
        }
        case 7:
        {
            content = "100mA";
        }
    }
    return content;
}

// CSD Register VDD_CURR_MAX
function VDD_CURR_MAX(value)
{
    var content = "";
    switch(Number(value))
    {
        case 0:
        {
            return content = "1mA";
        }
        case 1:
        {
            return content = "5mA";
        }
        case 2:
        {
            return content = "10mA";
        }
        case 3:
        {
            return content = "25mA";
        }
        case 4:
        {
            return content = "35mA";
        }
        case 5:
        {
            return content = "45mA";
        }
        case 6:
        {
            return content = "80mA";
        }
        case 7:
        {
            return content = "200mA";
        }
    }
}

function ERASE_BLK_EN(value)
{
    var content = "";
    if (Number(value) == 1)
    {

        return content = "Erase units of 512Bytes";
    }
    else
    {
        return content = "Erase units of 'SECTOR_SIZE' Bytes";
    }
}

function WP_GRP_ENABLE(value)
{
    var content = "";
    if (Number(value) == 1)
    {
        return content = "Group Write Protection Possible";
    }
    else
    {
        return content = "Group Write Protection Impossible";
    }
}

function R2W_FACTOR(value, CSD_version, item_display)
{
    var content = "";
    if (CSD_version == 0)
    {
        if (Number(value) > 5)
        {
            packet_string = "These bits should be set to 0";
            types = "Error";
            ScanaStudio.dec_item_add_content("These bits should be set to 0");
            ScanaStudio.dec_item_emphasize_error();
        }
        else
        {
            packet_string = "Write Speed Factor" + Math.pow(2,value);
            types = "Data";
            ScanaStudio.dec_item_add_content("Write Speed Factor (R2W_FACTOR)" + Math.pow(2,value));
            ScanaStudio.dec_item_add_content("R2W_FACTOR" + Math.pow(2,value));
        }
    }
    else
    {
        if (Number(value) == 2)
        {
            packet_string = "Write Speed Factor" + Math.pow(2,value);
            types = "Data";
            ScanaStudio.dec_item_add_content("Write Speed Factor (R2W_FACTOR)" + Math.pow(2,value));
            ScanaStudio.dec_item_add_content("R2W_FACTOR" + Math.pow(2,value));
        }
        else
        {
            packet_string = "In 2.0 Version, R2W factor is fixed to 4";
            types = "Error";
            ScanaStudio.dec_item_add_content("In 2.0 Version, R2W factor is fixed to 4");
            ScanaStudio.dec_item_emphasize_error();
        }
    }
    display_sample_0_1(sdio_simple, item_display);
    ScanaStudio.dec_item_end();
    //Packet View
    packet_view_add_packet_v2(ch_cmd,sdio_simple,"R2W_FACTOR",packet_string,types);
}

function COPY(value)
{
    var content = "";
    if (Number(value) == 1)
    {
        return content = "The content has been copied";
    }
    else
    {
        return content = "The content is original";
    }
}

function WRITE_PROTECT(value)
{
    var content = "";
    if (Number(value) == 1)
    {
        return content = "Content is protected";
    }
    else
    {
        return content = "Content isn't protected";
    }
}

function FILE_FORMAT(value, FILE_FORMAT_GRP)
{
    var content = "";

    if (FILE_FORMAT_GRP == 0)
    {
        switch (Number(value))
        {
            case 0 :
            {
                return content = "Hard disk-like file system with partition table ";
            }
            case 1 :
            {
                return content = "DOS FAT (floppy-like) with boot sector only (no partition table)";
            }
            case 2 :
            {
                return content = "Universal File Format ";
            }
            case 3 :
            {
                return content = "Others/Unknown";
            }
        }
    }
    else
    {
        return content = "Reserved";
    }
}

// END CSD FUNCTIONS
//------------------------------------------------------------------------------------------------------------------------//

function reserved_bit(decoder_result_t) // When there is reserved bit, it create the dec_item, content, samples, packet_view
{
    dec_item_new_v2(ch_cmd,sdio_simple);
    if (sdio_simple.unsigned_words == 0)
    {
        packet_string = "Reserved bits";
        types = "Data";
        ScanaStudio.dec_item_add_content("Reserved bits");
    }
    else
    {
        packet_string = "Reserved bits should be 0";
        types = "Error";
        ScanaStudio.dec_item_add_content("Reserved bits should be 0");
        ScanaStudio.dec_item_add_content("Should be 0");
        ScanaStudio.dec_item_emphasize_error();
    }
    display_sample(sdio_simple);
    ScanaStudio.dec_item_end();
    //Packet View
    packet_view_add_packet_v2(ch_cmd,sdio_simple,"Reserved bit",packet_string,types);
}

// Simplify the sync_decode_function
function sync_decode_v2 (channel,clock_start_sample,bits_per_word)
{
    var tab_1 = [];
    var tab_2 = [];
    var pretab_1 = [];
    var pretab_2 = [];
    var signed_words = [];
    var unsigned_words = [];
    var valid_bit = 0;
    var sampling_point = [];
    var current_start_sample = clock_start_sample;
    var channel_length = channel.length; // 1 or 4 (1CMD or 1 DAT or 4 DAT)
    var clock_polarity;
    var ch_cmd = ScanaStudio.gui_get_value("ch_cmd");
    if ((ScanaStudio.gui_get_value("DDR") == true) && channel[0] != ch_cmd)
    {
        clock_polarity = -1;
    }
    else
    {
        clock_polarity = 1;
    }
        for (b=0; (b < Math.floor(bits_per_word/32)) && (ScanaStudio.trs_is_not_last(ch_clk)); b++)
        {
            decoder_result_t = ScanaStudio.sync_decode(ch_clk,channel,current_start_sample,clock_polarity,true,32,false,0,-1);
            if (decoder_result_t.valid_bits != 32)
            {
              last_trans = true;
            }
            current_start_sample = decoder_result_t.end_sample + 1;

            pretab_1 = dec2bin(decoder_result_t.unsigned_words,32);
            pretab_2 = dec2bin(decoder_result_t.signed_words,32);
            for (k=0; k<32; k++)
            {
                tab_1.push(pretab_1[k]);
                tab_2.push(pretab_2[k]);
                sampling_point.push(decoder_result_t.start_sample + decoder_result_t.sampling_points[k] - decoder_result_t.sampling_points[0]);
            }
            valid_bit += decoder_result_t.valid_bits;
        }
        if(ScanaStudio.trs_is_not_last(ch_clk))
        {
            if (bits_per_word%32 != 0)
            {
                decoder_result_t = ScanaStudio.sync_decode(ch_clk,channel,current_start_sample,clock_polarity,true,bits_per_word%32,false,0,-1);
                if (decoder_result_t.valid_bits != bits_per_word%32)
                {
                    last_trans = true;
                }
                pretab_1 = dec2bin(decoder_result_t.unsigned_words,bits_per_word%32);
                pretab_2 = dec2bin(decoder_result_t.signed_words,bits_per_word%32);
                for (k=0; k<bits_per_word%32; k++)
                {
                    tab_1.push(pretab_1[k]);
                    tab_2.push(pretab_2[k]);
                    sampling_point.push(decoder_result_t.start_sample + decoder_result_t.sampling_points[k] - decoder_result_t.sampling_points[0]);
                }
                valid_bit += decoder_result_t.valid_bits;
            }
        }
        unsigned_words.push(bin2dec(tab_1,bits_per_word));
        signed_words.push(bin2dec(tab_2,bits_per_word));
        if (bits_per_word > 32)
        {
            decoder_result_t.signed_words = tab_1;
            decoder_result_t.unsigned_words = tab_2;
            decoder_result_t.valid_bits = valid_bit;
            decoder_result_t.sampling_points = sampling_point;
            decoder_result_t.start_sample = decoder_result_t.sampling_points[0];
            decoder_result_t.end_sample = decoder_result_t.sampling_points[bits_per_word-1];
        }
        else
        {
            decoder_result_t.signed_words = signed_words;
            decoder_result_t.unsigned_words = unsigned_words;
            decoder_result_t.valid_bits = valid_bit;
            decoder_result_t.sampling_points = sampling_point;
            decoder_result_t.start_sample = decoder_result_t.sampling_points[0];
            decoder_result_t.end_sample = decoder_result_t.sampling_points[bits_per_word-1];
        }

        return decoder_result_t;
}

// Simplify the sync_decode_function
function sync_decode_v3 (channel,clock_start_sample,bits_per_word)
{
    var sampling_point = [];
    var start = clock_start_sample;
    var ch_cmd = ScanaStudio.gui_get_value("ch_cmd");
    if ((ScanaStudio.gui_get_value("DDR") == true) && (channel[0] != ch_cmd))
    {
        var clock_polarity = -1;
    }
    else
    {
        var clock_polarity = 1;
    }
    decoder_result_t = ScanaStudio.sync_decode(ch_clk,channel,start,clock_polarity,true,bits_per_word,false,0,-1);
    if (bits_per_word != (decoder_result_t.valid_bits))
    {
      var ch_number = channel[0] + 1;
      last_trans = true;
      return decoder_result_t;
    }
    for (k=0; k<bits_per_word; k++)
    {
        sampling_point.push(decoder_result_t.start_sample + decoder_result_t.sampling_points[k] - decoder_result_t.sampling_points[0]);
    }
    decoder_result_t.sampling_points = sampling_point;
    return decoder_result_t;
}

function trs_clk_before_v2 (sample_index)
{
    var trs_start = ScanaStudio.trs_get_before(ch_clk,sample_index + 1);
    var tmp_trs_sample_index;
    tmp_trs_sample_index = trs_start.sample_index;
    while( (tmp_trs_sample_index == trs_start.sample_index) && (ScanaStudio.trs_is_not_last(ch_clk) == true) )
    {
        trs_start = ScanaStudio.trs_get_previous(ch_clk);
    }
    tmp_trs_sample_index = trs_start.sample_index;
    while( (tmp_trs_sample_index == trs_start.sample_index) && (ScanaStudio.trs_is_not_last(ch_clk) == true) )
    {
        trs_start = ScanaStudio.trs_get_next(ch_clk);
    }
    return trs_start.sample_index;
}

function trs_clk_after_v2 (sample_index)
{
    var trs_end = ScanaStudio.trs_get_before(ch_clk,sample_index + 1);
    var tmp_trs_sample_index;
    tmp_trs_sample_index = trs_end.sample_index;
    while( (tmp_trs_sample_index == trs_end.sample_index) && (ScanaStudio.trs_is_not_last(ch_clk) == true) )
    {
        trs_end = ScanaStudio.trs_get_next(ch_clk);
    }
    return trs_end.sample_index;
}

function dec_item_new_v2 (data_channel, sdio_simple)
{
    var ddr_mode = ScanaStudio.gui_get_value("DDR");
    var ch_cmd = ScanaStudio.gui_get_value("ch_cmd");
    if ((ddr_mode == false) || (data_channel == ch_cmd)) //Sample on rising edge
    {
        var trs_start = ScanaStudio.trs_get_before(ch_clk,sdio_simple.start_sample + 1);
        var tmp_trs_sample_index;
        tmp_trs_sample_index = trs_start.sample_index;
        while( (tmp_trs_sample_index == trs_start.sample_index) && (ScanaStudio.trs_is_not_last(ch_clk) == true) )
        {
            trs_start = ScanaStudio.trs_get_previous(ch_clk);
        }
        tmp_trs_sample_index = trs_start.sample_index;
        while( (tmp_trs_sample_index == trs_start.sample_index) && (ScanaStudio.trs_is_not_last(ch_clk) == true) )
        {
            trs_start = ScanaStudio.trs_get_next(ch_clk);
        }
        var trs_end = ScanaStudio.trs_get_before(ch_clk,sdio_simple.end_sample + 1);
        var tmp_trs_sample_index;
        tmp_trs_sample_index = trs_end.sample_index;
        while( (tmp_trs_sample_index == trs_end.sample_index) && (ScanaStudio.trs_is_not_last(ch_clk) == true) )
        {
            trs_end = ScanaStudio.trs_get_next(ch_clk);
        }
        var bool = (trs_end.sample_index - trs_start.sample_index)/sampling_rate > (2e-3);
        if (bool)
        {
            if (data_channel == ch_cmd)
            {
                state_machine == ENUM_STATE_CMD_START;
            }
            else
            {
                state_machine == ENUM_STATE_DATA_START;
            }
            return [trs_start.sample_index, trs_end.sample_index];
        }
        test = ScanaStudio.dec_item_new(data_channel,trs_start.sample_index ,trs_end.sample_index - 1);
        if (test != 1)
        {
            error ++;
        }
        return [trs_start.sample_index, trs_end.sample_index];
    }
    else // Sample on every edge for the DAT-Lines
    {
        var trs_start = ScanaStudio.trs_get_before(ch_clk,sdio_simple.start_sample + 1);
        var tmp_trs_sample_index;
        tmp_trs_sample_index = trs_start.sample_index;
        while( (tmp_trs_sample_index == trs_start.sample_index) && (ScanaStudio.trs_is_not_last(ch_clk) == true) )
        {
            trs_start = ScanaStudio.trs_get_previous(ch_clk);
        }
        tmp_trs_sample_index = trs_start.sample_index;
        while( (tmp_trs_sample_index == trs_start.sample_index) && (ScanaStudio.trs_is_not_last(ch_clk) == true) )
        {
            trs_start = ScanaStudio.trs_get_next(ch_clk);
        }
        var quarter_clk_sample = get_quarter_clk_sample(trs_start.sample_index);
        test = ScanaStudio.dec_item_new(data_channel,trs_start.sample_index + quarter_clk_sample, sdio_simple.end_sample + quarter_clk_sample -1);
        if (test != 1)
        {
            // ScanaStudio.console_info_msg("sdio_simple.start_sample ",sdio_simple.start_sample);
            // ScanaStudio.console_info_msg("(trs_start.sample_index + quarter_clk_sample) : " + trs_start.sample_index ,(trs_start.sample_index ));
            // ScanaStudio.console_info_msg("sdio_simple.end_sample - 1",sdio_simple.end_sample + quarter_clk_sample -1);
            // ScanaStudio.console_info_msg("test_v2 : " + test);
        }
        return [trs_start.sample_index, sdio_simple.end_sample - 1];
    }
}

function get_quarter_clk_sample (sample_value)
{
    var clock_first_edge_sample = ScanaStudio.trs_get_before(ch_clk,sample_value);
    var clock_second_edge_sample = ScanaStudio.trs_get_before(ch_clk,sample_value);
    var tmp_trs_sample_index;
    tmp_trs_sample_index = clock_second_edge_sample.sample_index;
    while( (tmp_trs_sample_index == clock_second_edge_sample.sample_index) && (ScanaStudio.trs_is_not_last(ch_clk) == true) )
    {
        clock_second_edge_sample = ScanaStudio.trs_get_next(ch_clk);
    }
    tmp_trs_sample_index = clock_second_edge_sample.sample_index;
    while( (tmp_trs_sample_index == clock_second_edge_sample.sample_index) && (ScanaStudio.trs_is_not_last(ch_clk) == true) )
    {
        clock_second_edge_sample = ScanaStudio.trs_get_next(ch_clk);
    }
    return (clock_second_edge_sample.sample_index-clock_first_edge_sample.sample_index)/4;
}

// If Sync decode overpass the last sample, finish the decoding
function go_to_last_trans_cmd()
{
        while (ScanaStudio.trs_is_not_last(ch_cmd))
        {
            trs_cmd = ScanaStudio.trs_get_next(ch_cmd);
        }
            state_machine = ENUM_STATE_DATA_START;
}

// If Sync decode overpass the last sample, finish the decoding
function go_to_last_trans_data()
{
        while (ScanaStudio.trs_is_not_last(ch_dat0))
        {
            trs_dat0 = ScanaStudio.trs_get_next(ch_dat0);
        }
            state_machine = ENUM_STATE_CMD_START;
}

// Return an array of n bits
function dec2bin (data, nbits)
{
  var tab = [];
  var n = 0;
  var a = new Number(data);

  for (n = nbits-1; n >= 0 ; n--)
  {
      tab.push((parseInt(data)>>n)&0x1);
  }
  return tab;
}


// Return decimal value of nbits bits array
function bin2dec (array, nbits)
{
  var dec = 0;
  for (i = 0; i < nbits; i++)
  {
    dec += array[i]*Math.pow(2,(nbits-1-i));
  }
  return dec;
}


// Return 5 decimal value in final_array from a 40 bits array
function crc_array(array)
{
    var final_array = [];
    var dec = 0;
    for (j=0; j<array.length/8; j++)
    {
        for (i=0; i<8; i++)
        {
            dec += array[(j*8)+i]*Math.pow(2,7-i);
        }
        final_array.push(dec);
        dec = 0;
    }
    return final_array;
}

function flag_data_error(item_display)
{
    var str_error = "";
    var io_current_state_value = 0;
    if (item_display[0] == 1)
    {
        str_error += "COM_CRC_ERROR/";
        ScanaStudio.dec_item_emphasize_error();
    }
    if (item_display[1] == 1)
    {
        str_error += "ILLEGAL_COMMAND ERROR/";
        ScanaStudio.dec_item_emphasize_error();
    }
    if (item_display[4] == 1)
    {
        str_error += "GENERAL ERROR/";
        ScanaStudio.dec_item_emphasize_error();
    }
    if (item_display[5] == 1)
    {
        str_error += "6th bit should be set at 0/";
        ScanaStudio.dec_item_emphasize_warning();
    }
    if (item_display[6] == 1)
    {
        str_error += "FUNCTION NUMBER INVALID/";
        ScanaStudio.dec_item_emphasize_error();
    }
    if (item_display[7] == 1)
    {
        str_error += "OUT_OF_RANGE ERROR";
        ScanaStudio.dec_item_emphasize_error();
    }
    for(i=2; i<4; i++)
    {
        io_current_state_value += Math.pow(2,3-i)*item_display[i];
    }
    var str_state = "";
    switch (io_current_state_value)
    {
        case 0 :
        {
            str_state = "/IO CURRENT STATE : DIS=Disabled";
            break;
        }
        case 1 :
        {
            str_state = "/IO CURRENT STATE : CMD=DAT Lines free";
            break;
        }
        case 2 :
        {
            str_state = "/IO CURRENT STATE : TRF=Transfer";
            break;
        }
        case 3 :
        {
            str_state = "/IO CURRENT STATE : RFU";
            break;
        }
    }
    return [str_error, str_state];
}

function card_status_error_16(bit_array)
{
    var str = "";
    var n = 0;
    types = "Data";
    if (SDIO_only == false)
    {
        if (bit_array[0] == 1)
        {
            str += "COM_CRC_ERROR/";
            types = "Error";
            ScanaStudio.dec_item_emphasize_error();
        }
        if (bit_array[1] == 1)
        {
            str += "ILLEGAL_COMMAND ERROR/";
            types = "Error";
            ScanaStudio.dec_item_emphasize_error();
        }
        if (bit_array[2] == 1)
        {
            str += "GENERAL ERROR/";
            types = "Error";
            ScanaStudio.dec_item_emphasize_error();
        }
        if (bit_array[7] == 1)
        {
            str += "NOT READY_FOR_DATA/";
        }
        var current_state_value_2 = 0;
        for (i=3; i<7; i++)
        {
            current_state_value_2 += Math.pow(2,6-i)*bit_array[i];
        }
        switch (current_state_value_2)
        {
            case 0 :
            {
                str += " CURRENT STATE : idle";
                break;
            }
            case 1 :
            {
                str += " CURRENT STATE : ready";
                break;
            }
            case 2 :
            {
                str += " CURRENT STATE : ident";
                break;
            }
            case 3 :
            {
                str += " CURRENT STATE : stby";
                break;
            }
            case 4 :
            {
                str += " CURRENT STATE : tran";
                break;
            }
            case 5 :
            {
                str += " CURRENT STATE : data";
                break;
            }
            case 6 :
            {
                str += " CURRENT STATE : rcv";
                break;
            }
            case 7 :
            {
                str += " CURRENT STATE : prg";
                break;
            }
            case 8 :
            {
                str += " CURRENT STATE : dis";
                break;
            }
            case 15 :
            {
                str += " CURRENT STATE : Reserved for I/O mode ";
                break;
            }
            default :
            {
                str += " CURRENT STATE : Reserved";
                break;
            }
        }
    }
    else
    {
        if (bit_array[0] == 1)
        {
            str += "COM_CRC_ERROR/";
            ScanaStudio.dec_item_emphasize_error();
        }
        if (bit_array[1] == 1)
        {
            str += "ILLEGAL_COMMAND ERROR/";
            ScanaStudio.dec_item_emphasize_error();
        }
        if (bit_array[2] == 1)
        {
            str += "GENERAL ERROR";
            ScanaStudio.dec_item_emphasize_error();
        }
    }
    if (types == "Data")
    {
        packet_string = str;
        ScanaStudio.dec_item_add_content("OK, no errors  " + str);
        ScanaStudio.dec_item_add_content(str);
    }
    else
    {
        if (str.length > 33)
        {
            packet_string = "Errors, look item" ;
        }
        else
        {
            packet_string = str ;
            ScanaStudio.dec_item_add_content(str);
        }

        show_pdf_on_console = true;
        ScanaStudio.dec_item_add_content(str);
        ScanaStudio.dec_item_add_content("Too many Errors, cannot be displayed, look significance on sdio specifications");
    }

    display_sample_0_1(sdio_simple,item_display);
    ScanaStudio.dec_item_end();
    //Packet View
    packet_view_add_packet_v2(ch_cmd,sdio_simple,"Card Status",packet_string,types);
    return str;
}

function card_status_error_32(bit_array)
{
    var str = "";
    var types = "Data";
    value_bit_array = bit_array[i];
    if (bit_array[0] == 1)
    {
        str += "OUT_OF_RANGE ERROR/";
        types = "Error";
        ScanaStudio.dec_item_emphasize_error();
    }
    if (bit_array[1] == 1)
    {
        str += "ADRESS ERROR/";
        types = "Error";
        ScanaStudio.dec_item_emphasize_error();
    }
    if (bit_array[2] == 1)
    {
        str += "BLOCK_LEN ERROR/";
        types = "Error";
        ScanaStudio.dec_item_emphasize_error();
    }
    if (bit_array[3] == 1)
    {
        str += "ERASE_SEQ ERROR/";
        types = "Error";
        ScanaStudio.dec_item_emphasize_error();
    }
    if (bit_array[4] == 1)
    {
        str += "ERASE_PARAM ERROR/";
        types = "Error";
        ScanaStudio.dec_item_emphasize_error();
    }
    if (bit_array[5] == 1)
    {
        str += "WP_VIOLATION, this block is protected/";
        types = "Error";
        ScanaStudio.dec_item_emphasize_warning();
    }
    if (bit_array[6] == 1)
    {
        str += "CARD IS LOCKED/";
        Card_is_Lock = true;
        ScanaStudio.dec_item_emphasize_warning();
    }
    else
    {
        Card_is_Lock = false;
    }
    if (bit_array[7] == 1)
    {
        str += "LOCK_UNLOCK_FAILED ERROR/";
        types = "Error";
        ScanaStudio.dec_item_emphasize_error();
    }
    if (bit_array[8] == 1)
    {
        str += "COM_CRC_ERROR/";
        types = "Error";
        ScanaStudio.dec_item_emphasize_error();
    }
    if (bit_array[9] == 1)
    {
        str += "ILLEGAL_COMMAND ERROR/";
        types = "Error";
        ScanaStudio.dec_item_emphasize_error();
    }
    if (bit_array[10] == 1)
    {
        str += "CARD_ECC FAILED/";
        types = "Error";
        ScanaStudio.dec_item_emphasize_error();
    }
    if (bit_array[11] == 1)
    {
        str += "CC ERROR/";
        types = "Error";
        ScanaStudio.dec_item_emphasize_error();
    }
    if (bit_array[12] == 1)
    {
        str += "GENERAL ERROR/";
        types = "Error";
        ScanaStudio.dec_item_emphasize_error();
    }
    if (bit_array[15] == 1)
    {
        str += "CSD_OVERWRITE ERROR/";
        types = "Error";
        ScanaStudio.dec_item_emphasize_error();
    }
    if (bit_array[16] == 1)
    {
        str += "WP_ERASE_SKIP ERROR, SOME BLOCK ARE PROTECTED/";
        types = "Error";
        ScanaStudio.dec_item_emphasize_error();
    }
    if (bit_array[17] == 1)
    {
        str += "CARD_ECC IS DISABLED/";
        ScanaStudio.dec_item_emphasize_warning();
    }
    if (bit_array[18] == 1)
    {
        str += "ERASE_RESET ERROR/";
        types = "Error";
        ScanaStudio.dec_item_emphasize_error();
    }
    // 19 to 22 are used together
    if (bit_array[23] == 1)
    {
        str += "NOT READY_FOR_DATA/";
    }
    // Reserved
    if (bit_array[25] == 1)
    {
        str += "EVENT INVOKED/";
    }
    if (bit_array[26] == 1)
    {
        str += "APP_CMD Enabled/";
    }
    // 27 is reserved for SD I/O Card
    if (bit_array[28] == 1)
    {
        str += "AKE_SEQ ERROR";
        types = "Error";
        ScanaStudio.dec_item_emphasize_error();
    }
    // 29-31 Reserved
    var current_state_value_2 = 0;
    for (i=19; i<23; i++)
    {
        current_state_value_2 += Math.pow(2,22-i)*bit_array[i];
    }
    switch (current_state_value_2)
    {
        case 0 :
        {
            str += " CURRENT STATE : idle";
            break;
        }
        case 1 :
        {
            str += " CURRENT STATE : ready";
            break;
        }
        case 2 :
        {
            str += " CURRENT STATE : ident";
            break;
        }
        case 3 :
        {
            str += " CURRENT STATE : stby";
            break;
        }
        case 4 :
        {
            str += " CURRENT STATE : tran";
            break;
        }
        case 5 :
        {
            str += " CURRENT STATE : data";
            break;
        }
        case 6 :
        {
            str += " CURRENT STATE : rcv";
            break;
        }
        case 7 :
        {
            str += " CURRENT STATE : prg";
            break;
        }
        case 8 :
        {
            str += " CURRENT STATE : dis";
            break;
        }
        case 15 :
        {
            str += " CURRENT STATE : Reserved for I/O mode ";
            break;
        }
        default :
        {
            str += " CURRENT STATE : Reserved";
            break;
        }
    }
    if (types == "Data")
    {
        packet_string = str;
        ScanaStudio.dec_item_add_content("OK, no errors  " + str);
        ScanaStudio.dec_item_add_content(str);
    }
    else
    {
        if (str.length > 33)
        {
            packet_string = "Errors, look item" ;
        }
        else
        {
            packet_string = str ;
            ScanaStudio.dec_item_add_content(str);
        }

        show_pdf_on_console = true;
        ScanaStudio.dec_item_add_content(str);
        ScanaStudio.dec_item_add_content("Too many Errors, cannot be displayed, look significance on sdio specifications");
    }

    display_sample_0_1(sdio_simple,item_display);
    ScanaStudio.dec_item_end();
    //Packet View
    packet_view_add_packet_v2(ch_cmd,sdio_simple,"Card Status",packet_string,types);
    return str;
}

// Task Status
function task_status_error_32(item_display, sdio_simple)
{
    var str = "";
    var test = 0;
    for (i=0; i<32; i++)
    {
        if(item_display[i] == 1)
        {
            if (str != "")
            {
                str += "/" + (31-i);
            }
            else
            {
                str += "Task " + (31-i) ;
            }
        }
    }
    packet_string = str;
    str += " Ready";
    if (str.length > 33)
    {
        packet_string = "Too many task ready, look item";
    }
    // show_pdf_on_console = true;
    ScanaStudio.dec_item_add_content(str);
    display_sample_0_1(sdio_simple,item_display);
    ScanaStudio.dec_item_end();
    //Packet View
    packet_view_add_packet_v2(ch_cmd,sdio_simple,"Task Status",packet_string,"Data");
    return str;
}

//--------------------------------------------------------------------------------------------------------------//

// OCR Functions

function Voltage_window_24(bit_array,sdio_simple,ch)
{
    var VDD = [];
    var VDD_max = 0.0;
    var VDD_min = 0.0;
    var n = 1;
    var ch_cmd = "ch_cmd";
    var test = 16;
    for (i=0; i<16; i++)
    {
        if (bit_array[i] == 1)
        {
            VDD.push(3.6-0.1*(i));
            test ++;
        }
        test --;
    }
    for (i=16; i<24; i++)
    {
        if (bit_array[i] == 1)
        {
            n = 0;
        }
    }
    if (test > 0)
    {
        VDD_max = Math.max.apply(Math, VDD);
        VDD_min = Math.min.apply(Math, VDD) - 0.1;
    }
    var packet_string = "";
    var types = "";
    packet_string = "VDD voltage window " + VDD_min.toFixed(1) + "-" + VDD_max.toFixed(1) + "V";
    if (n == 1)
    {
        types = "Data";
        ScanaStudio.dec_item_add_content("VDD voltage window " + VDD_min.toFixed(1) + "-" + VDD_max.toFixed(1) + "V");
    }
    else
    {
        types = "Error";
        ScanaStudio.dec_item_add_content("Reserved bits should be 0");
        ScanaStudio.dec_item_emphasize_error();
    }
    packet_view_add_packet_v2(ch,sdio_simple,"OCR",packet_string,types);
}

function Voltage_window_32(bit_array,ch_cmd,sdio_simple,ch)
{
    var VDD = [];
    var VDD_max = 0.0;
    var VDD_min = 0.0;
    var n = 0;
    for (i=8; i<24; i++)
    {
        if (bit_array[i] == 1)
        {
            VDD.push(3.6-0.1*(i-8));
            n = 1;
        }
    }
    VDD_max = Math.max.apply(Math, VDD);
    VDD_min = Math.min.apply(Math, VDD) - 0.1;
    for (i=24; i<32; i++)
    {
        if (bit_array[i] == 1)
        {
            n = 0;
        }
    }
    if (bit_array[0] == 1)
    {
        str = "Power up procedure is finish";
    }
    else
    {
        str = "Power up procedure still is in progress";
    }
    if (bit_array[1] == 1)
    {
        str += "/SDHC or SDXC";
    }
    else
    {
        str += "/SDSC";
        SD_CARD_TYPE == 0;
    }
    if (bit_array[2] == 1)
    {
        str += "/UHS-II Card";
    }
    else
    {
        str += "/Non UHS-II Card";
        SD_CARD_TYPE == 0;
    }
    var packet_string = "";
    var types = "";
    dec_item_new_v2(ch_cmd,sdio_simple);
    if (n == 1)
    {
        packet_string = "VDD voltage window " + VDD_min.toFixed(1) + "-" + VDD_max.toFixed(1) + "V";
        types = "Data";
        ScanaStudio.dec_item_add_content(str + "/VDD voltage window " + VDD_min.toFixed(1) + "-" + VDD_max.toFixed(1) + "V");
    }
    else
    {
        types = "Error";
        ScanaStudio.dec_item_add_content("Reserved bits should be 0");
        ScanaStudio.dec_item_emphasize_error();
    }
    display_sample(sdio_simple);
    ScanaStudio.dec_item_end();
    // Packet View
    packet_view_add_packet_v2(ch,sdio_simple,"OCR",packet_string,types);
}

// END OSC Functions

//--------------------------------------------------------------------------------------------------------------//

// CMD 6, Functions group

function function_group_1(value, mode)
{
    var str = "";
    if (mode == 1)
    {
        str += "Switch to ";
    }
    else
    {
        str += "Check if ";
    }
    switch(value)
    {
        case 0 :
        {
            str += "Default/SDR12";
            break;
        }
        case 1 :
        {
            str += "High-Speed/SDR25";
            break;
        }
        case 2 :
        {
            str += "SDR50";
            break;
        }
        case 3 :
        {
            str += "SDR104";
            break;
        }
        case 4 :
        {
            str += "DDR50";
            break;
        }
        case 15 :
        {
            return str = "Do nothing";
        }
        default :
        {
            return str = "Reserved function";
        }
    }
    if (mode == 0)
    {
        str += " is supported";
    }
    return str;
}

function function_group_2(value, mode)
{
    var str = "";
    if (mode == 1)
    {
        str += "Switch to ";
    }
    else
    {
        str += "Check if ";
    }
    switch(value)
    {
        case 0 :
        {
            str += "Default";
            break;
        }
        case 1 :
        {
            str += "For eC";
            break;
        }
        case 3 :
        {
            str += "OTP";
            break;
        }
        case 4 :
        {
            str += "ASSD";
            break;
        }
        case 14 :
        {
            str += "Vendor Specific";
            break;
        }
        case 15 :
        {
            return str = "Do nothing";
        }
        default :
        {
            return str = "Reserved function";
        }
    }
    if (mode == 0)
    {
        str += " is supported";
    }
    return str;
}

function function_group_3(value, mode)
{
    var str = "";
    if (mode == 1)
    {
        str += "Switch to ";
    }
    else
    {
        str += "Check if ";
    }
    switch(value)
    {
        case 0 :
        {
            str += "Default/Type B";
            break;
        }
        case 1 :
        {
            str += "Type A";
            break;
        }
        case 2 :
        {
            str += "Type C";
            break;
        }
        case 3 :
        {
            str += "Type D";
            break;
        }
        case 15 :
        {
            return str = "Do nothing";
        }
        default :
        {
            return str = "Reserved function";
        }
    }
    if (mode == 0)
    {
        str += " is supported";
    }
    return str;
}

function function_group_4(value, mode)
{
    var str = "";
    if (mode == 1)
    {
        str += "Switch to ";
    }
    else
    {
        str += "Check if ";
    }
    switch(value)
    {
        case 0 :
        {
            str += "Default/0.72W";
            break;
        }
        case 1 :
        {
            str += "1.44W";
            break;
        }
        case 2 :
        {
            str += "2.16W";
            break;
        }
        case 3 :
        {
            str += "2.88W";
            break;
        }
        case 3 :
        {
            str += "1.80W";
            break;
        }
        case 15 :
        {
            return str = "Do nothing";
        }
        default :
        {
            return str = "Reserved function";
        }
    }
    if (mode == 0)
    {
        str += " is supported";
    }
    return str;
}

//END CMD6, functions group
//--------------------------------------------------------------------------------------------------------------//

// Command Queue Functions related

function operation_code(value)
{
    var str = "";
    switch (value)
    {
        case 0 :
        {
            str = "Reserved";
            break;
        }
        case 1 :
        {
            str = "Abort Entire Queue";
            break;
        }
        case 2 :
        {
            str = "Abort Task ID";
            break;
        }
        default :
        {
            str = "Reserved";
            break;
        }
    }
    return str;
}

//--------------------------------------------------------------------------------------------------------------//

// Extension Commands Functions related

function FNO(item_display, MIO_value)
{
    var str = "";
    var FNO_value = 0;
    if(MIO_value == 1) // I/O Extension
    {
        for (i=3; i>0; i--)
        {
            FNO_value = item_display[i]*Math.pow(2,i-1);
        }
        return str = "Function " + FNO_value;
        if (item_display[0] == 1)
        {
            return str += ", fourth bit should be set to 0";
            ScanaStudio.dec_item_emphasize_warning();
        }
    }
    else //Memory Extension
    {
        for (i=3; i>=0; i--)
        {
            FNO_value = item_display[i]*Math.pow(2,i);
        }
        return str = "Function " + FNO_value;
    }
}

function display_sample(decoder_result_t)
{
    for (i=0; i < decoder_result_t.sampling_points.length; i++)
    {
        ScanaStudio.dec_item_add_sample_point(decoder_result_t.sampling_points[i],"P");
    }
}

function display_sample_0_1(decoder_result_t, display_array)
{
    for (i=0; i < decoder_result_t.sampling_points.length; i++)
    {
        if (display_array[i] == 1)
        {
            ScanaStudio.dec_item_add_sample_point(decoder_result_t.sampling_points[i],"1");
        }
        else
        {
            ScanaStudio.dec_item_add_sample_point(decoder_result_t.sampling_points[i],"0");
        }
    }
}

// Push into bit_array the binary value of "value" (value is coded in nbits)
function crc_pre_calcul(value, nbits, bit_array)
{
    tab = [];
    for (i=nbits-1; i>=0; i--)
    {
        tab.push((Number(value)>>i)&0x1);
    }
    for (j=0; j<nbits; j++)
    {
        bit_array.push(tab[j]);
    }
    return tab;
}


function fill_item_array(value,nbits,item_array)
{
  tab = [];
  for (i=nbits-1; i>=0; i--)
  {
      tab.push((Number(value)>>i)&0x1);
  }
  for (j=0; j<nbits; j++)
  {
      item_array.push(tab[j]);
  }
  return tab;
}

//---------------------------------------------------------------------------------------------------------------------//
// Functions used to decode CMD 6 data

// Function used to decode the Wide Width Data

function CMD6_function_supported(value)
{
    var tab = [];
    tab = dec2bin(value, 16);
    var str = "Function ";
    var first = true;
    for (i = 0; i<16; i++)
    {
        if (tab[i] == 1)
        {
            var function_nb = 15-i;
            if (first)
            {
                str += function_nb ;
                first = false;
            }
            else
            {
                str += "/" + function_nb ;
            }
        }
    }
    return str;
}

// ACMD13 Data Functions

function CMD13_speed_class(value)
{
    var str = "";
    if (value > 3)
    {
        return str = "Class 10 and below are effective";
    }
    else if (value > 2)
    {
        return str = "Class 6 and below are effective";
    }
    else if (value > 1)
    {
        return str = "Class 4 and below are effective";
    }
    else if (value > 0)
    {
        return str = "Class 2 and below are effective";
    }
    else if (value == 0)
    {
        return str = "Class 0 is effective";
    }
}


function UHS_SPEED_GRADE(value)
{
    var str = "";
    if (value == 0)
    {
        return str = "Less than 10MB/sec";
    }
    else if (value == 1)
    {
        return str = "10MB/sec and above";
    }
    else if (value == 3)
    {
        return str = "30MB/sec and above";
    }
    else
    {
        return str = "Reserved";
    }
}

function AU_SIZE(value)
{
    var str = "";
    switch (value)
    {
        case 0 :
        {
            str = "Not Defined";
            break;
        }
        case 1 :
        {
            str = "16 KB";
            break;
        }
        case 2 :
        {
            str = "32 KB";
            break;
        }
        case 3 :
        {
            str = "64 KB";
            break;
        }
        case 4 :
        {
            str = "128 KB";
            break;
        }
        case 5 :
        {
            str = "256 KB";
            break;
        }
        case 6 :
        {
            str = "512 KB";
            break;
        }
        case 7 :
        {
            str = "1 MB";
            break;
        }
        case 8 :
        {
            str = "2 MB";
            break;
        }
        case 9 :
        {
            str = "4 MB";
            break;
        }
        case 10 :
        {
            str = "8 MB";
            break;
        }
        case 11 :
        {
            str = "12 MB";
            break;
        }
        case 12 :
        {
            str = "16 MB";
            break;
        }
        case 13 :
        {
            str = "24 MB";
            break;
        }
        case 14 :
        {
            str = "32 MB";
            break;
        }
        case 15 :
        {
            str = "64 MB";
            break;
        }
    }
    return str;
}

function VSC_AU_SIZE(value)
{
    SIZE = [];
    var AU_SIZE = 0;
    var SU_SIZE = 0;
    switch(value)
    {
        case 8 :
        {
            AU_SIZE = value;
            SU_SIZE = 8;
            break;
        }
        case 16 :
        {
            AU_SIZE = value;
            SU_SIZE = 8;
            break;
        }
        case 21 :
        {
            AU_SIZE = value;
            SU_SIZE = 7;
            break;
        }
        case 24 :
        {
            AU_SIZE = value;
            SU_SIZE = 8;
            break;
        }
        case 27 :
        {
            AU_SIZE = value;
            SU_SIZE = 9;
            break;
        }
        case 28 :
        {
            AU_SIZE = value;
            SU_SIZE = 7;
            break;
        }
        case 30 :
        {
            AU_SIZE = value;
            SU_SIZE = 10;
            break;
        }
        case 32 :
        {
            AU_SIZE = value;
            SU_SIZE = 8;
            break;
        }
        case 36 :
        {
            AU_SIZE = value;
            SU_SIZE = 9;
            break;
        }
        case 40 :
        {
            AU_SIZE = value;
            SU_SIZE = 8;
            break;
        }
        case 42 :
        {
            AU_SIZE = value;
            SU_SIZE = 7;
            break;
        }
        case 45 :
        {
            AU_SIZE = value;
            SU_SIZE = 9;
            break;
        }
        case 48 :
        {
            AU_SIZE = value;
            SU_SIZE = 8;
            break;
        }
        case 54 :
        {
            AU_SIZE = value;
            SU_SIZE = 9;
            break;
        }
        case 56 :
        {
            AU_SIZE = value;
            SU_SIZE = 8;
            break;
        }
        case 60 :
        {
            AU_SIZE = value;
            SU_SIZE = 10;
            break;
        }
        case 64 :
        {
            AU_SIZE = value;
            SU_SIZE = 8;
            break;
        }
        case 72 :
        {
            AU_SIZE = value;
            SU_SIZE = 8;
            break;
        }
        case 80 :
        {
            AU_SIZE = value;
            SU_SIZE = 8;
            break;
        }
        case 96 :
        {
            AU_SIZE = value;
            SU_SIZE = 8;
            break;
        }
        case 112 :
        {
            AU_SIZE = value;
            SU_SIZE = 8;
            break;
        }
        case 120 :
        {
            AU_SIZE = value;
            SU_SIZE = 8;
            break;
        }
        case 128 :
        {
            AU_SIZE = value;
            SU_SIZE = 8;
            break;
        }
        case 144 :
        {
            AU_SIZE = value;
            SU_SIZE = 8;
            break;
        }
        case 160 :
        {
            AU_SIZE = value;
            SU_SIZE = 8;
            break;
        }
        case 192 :
        {
            AU_SIZE = value;
            SU_SIZE = 8;
            break;
        }
        case 216 :
        {
            AU_SIZE = value;
            SU_SIZE = 8;
            break;
        }
        case 224 :
        {
            AU_SIZE = value;
            SU_SIZE = 8;
            break;
        }
        case 240 :
        {
            AU_SIZE = value;
            SU_SIZE = 8;
            break;
        }
        case 256 :
        {
            AU_SIZE = value;
            SU_SIZE = 8;
            break;
        }
        case 288 :
        {
            AU_SIZE = value;
            SU_SIZE = 8;
            break;
        }
        case 320 :
        {
            AU_SIZE = value;
            SU_SIZE = 8;
            break;
        }
        case 384 :
        {
            AU_SIZE = value;
            SU_SIZE = 8;
            break;
        }
        case 432 :
        {
            AU_SIZE = value;
            SU_SIZE = 8;
            break;
        }
        case 448 :
        {
            AU_SIZE = value;
            SU_SIZE = 8;
            break;
        }
        case 480 :
        {
            AU_SIZE = value;
            SU_SIZE = 8;
            break;
        }
        case 512 :
        {
            AU_SIZE = value;
            SU_SIZE = 8;
            break;
        }
        default :
        {
            AU_SIZE = "Error";
            SU_SIZE = "Error" ;
            break;
        }
    }
    SIZE.push(AU_SIZE);
    SIZE.push(SU_SIZE);
    return SIZE;
}

function PERFORMANCE_ENHANCE(value)
{
    var tab = dec2bin(value, 8);
    var CQS = bin2dec (tab, 5);
    if (CQS == 0)
    {
        str += "Command Queue is not supported";
    }
    else
    {
        CQS++;
        str += "Command Queue supported, with  queue depth " + CQS;
    }
    if (tab[5] == 1)
    {
        str += "Support for Cache : Supported";
    }
    else
    {
        str += "Support for Cache : Not Supported";
    }
    if (tab[6] == 1)
    {
        str += "Support for Host_initiated maintenance : Supported";
    }
    else
    {
        str += "Support for Host_initiated maintenance : Not Supported";
    }
    if (tab[7] == 1)
    {
        str += "Support for Card_initiated maintenance : Supported";
    }
    else
    {
        str += "Support for Card_initiated maintenance : Not Supported";
    }
    return str;
}


//---------------------------------------------------------------------------------------------

// ACMD51 Data Functions
function Physical_Specification_Version(SD_SPEC, SD_SPEC3, SD_SPEC4, SD_SPECX)
{
    types = "Data";
    if (SD_SPEC == 0 && SD_SPEC3 == 0 && SD_SPEC4 == 0 && SD_SPECX == 0)
    {
        packet_string = "Version 1.0 and 1.01";
        ScanaStudio.dec_item_add_content("Physical_Specification : Version 1.0 and 1.01");
        ScanaStudio.dec_item_add_content("Version 1.0 and 1.01");
    }
    else if (SD_SPEC == 1 && SD_SPEC3 == 0 && SD_SPEC4 == 0 && SD_SPECX == 0)
    {
        packet_string = "Version 1.10";
        ScanaStudio.dec_item_add_content("Physical_Specification : Version 1.10");
        ScanaStudio.dec_item_add_content("Version 1.10");
    }
    else if (SD_SPEC == 2 && SD_SPEC3 == 0 && SD_SPEC4 == 0 && SD_SPECX == 0)
    {
        packet_string = "Version 2.00";
        ScanaStudio.dec_item_add_content("Physical_Specification : Version 2.00");
        ScanaStudio.dec_item_add_content("Version 2.00");
    }
    else if (SD_SPEC == 2 && SD_SPEC3 == 1 && SD_SPEC4 == 0 && SD_SPECX == 0)
    {
        packet_string = "Version 3.0x";
        ScanaStudio.dec_item_add_content("Physical_Specification : Version 3.0x");
        ScanaStudio.dec_item_add_content("Version 3.0x");
    }
    else if (SD_SPEC == 2 && SD_SPEC3 == 1 && SD_SPEC4 == 1 && SD_SPECX == 0)
    {
        packet_string = "Version 4.xx";
        ScanaStudio.dec_item_add_content("Physical_Specification : Version 4.xx");
        ScanaStudio.dec_item_add_content("Version 4.xx");
    }
    else if (SD_SPEC == 2 && SD_SPEC3 == 1 &&  SD_SPECX == 1)
    {
        packet_string = "Version 5.xx";
        ScanaStudio.dec_item_add_content("Physical_Specification : Version 5.xx");
        ScanaStudio.dec_item_add_content("Version 5.xx");
    }
    else if (SD_SPEC == 2 && SD_SPEC3 == 1 &&  SD_SPECX == 2)
    {
        packet_string = "Version 6.xx";
        ScanaStudio.dec_item_add_content("Physical_Specification : Version 6.xx");
        ScanaStudio.dec_item_add_content("Version 6.xx");
    }
    else if (SD_SPEC == 2 && SD_SPEC3 == 1 &&  SD_SPECX == 3)
    {
        packet_string = "Version 7.xx";
        ScanaStudio.dec_item_add_content("Physical_Specification : Version 7.xx");
        ScanaStudio.dec_item_add_content("Version 7.xx");
    }
    else
    {
        packet_string = "Reserved";
        types = "Error";
        ScanaStudio.dec_item_add_content("Physical_Specification : Reserved");
        ScanaStudio.dec_item_emphasize_warning();
    }
    packet_view_add_wide_width_packet(ch_dat0,sdio_simple,"Physical_Specification",packet_string,types);
}

function CMD_SUPPORT(value)
{
    var item_display = dec2bin(value, 4);
    var str = "";
    if(item_display[0] == 1)
    {
        str += "CMD58/59 ";
    }
    else if(item_display[1] == 1)
    {
        str += " CMD48/99 ";
    }
    else if(item_display[2] == 1)
    {
        str += " CMD23 ";
    }
    else if(item_display[3] == 1)
    {
        str += " CMD20";
    }
    return str;
}

//------------------------------------------------------------------------------------------------------------------//

// Change the block size for CMD53
function I_O_block_size(R_W, RAW, function_number, register_adress, value)
{
    if (RAW == 1 && function_number == 0 && register_adress == 17)
    {
        Function_0_block_size_1 = value;
    }
    if (RAW == 1 && function_number == 0 && register_adress == 16)
    {
        Function_0_block_size_2 = value * Math.pow(2,8);
    }
    Function_0_block_size = Function_0_block_size_1 + Function_0_block_size_2;

    if (RAW == 1 && function_number == 1 && register_adress == 273)
    {
        Function_1_block_size_1 = value;
    }
    if (RAW == 1 && function_number == 1 && register_adress == 272)
    {
        Function_1_block_size_2 = value * Math.pow(2,8);
    }
    Function_1_block_size = Function_1_block_size_1 + Function_1_block_size_2;

    if (RAW == 1 && function_number == 2 && register_adress == 273)
    {
        Function_2_block_size_1 = value;
    }
    if (RAW == 1 && function_number == 2 && register_adress == 272)
    {
        Function_2_block_size_2 = value * Math.pow(2,8);
    }
    Function_2_block_size = Function_2_block_size_1 + Function_2_block_size_2;

    if (RAW == 1 && function_number == 3 && register_adress == 273)
    {
        Function_3_block_size_1 = value;
    }
    if (RAW == 1 && function_number == 3 && register_adress == 272)
    {
        Function_3_block_size_2 = value * Math.pow(2,8);
    }
    Function_3_block_size = Function_3_block_size_1 + Function_3_block_size_2;

    if (RAW == 1 && function_number == 4 && register_adress == 273)
    {
        Function_4_block_size_1 = value;
    }
    if (RAW == 1 && function_number == 4 && register_adress == 272)
    {
        Function_4_block_size_2 = value * Math.pow(2,8);
    }
    Function_4_block_size = Function_4_block_size_1 + Function_4_block_size_2;

    if (RAW == 1 && function_number == 5 && register_adress == 273)
    {
        Function_5_block_size_1 = value;
    }
    if (RAW == 1 && function_number == 5 && register_adress == 272)
    {
        Function_5_block_size_2 = value * Math.pow(2,8);
    }
    Function_5_block_size = Function_5_block_size_1 + Function_5_block_size_2;

    if (RAW == 1 && function_number == 6 && register_adress == 273)
    {
        Function_6_block_size_1 = value;
    }
    if (RAW == 1 && function_number == 6 && register_adress == 272)
    {
        Function_6_block_size_2 = value * Math.pow(2,8);
    }
    Function_6_block_size = Function_6_block_size_1 + Function_6_block_size_2;
    if (RAW == 1 && function_number == 7 && register_adress == 273)
    {
        Function_7_block_size_1 = value;
    }
    if (RAW == 1 && function_number == 7 && register_adress == 272)
    {
        Function_7_block_size_2 = value * Math.pow(2,8);
    }
    Function_7_block_size = Function_7_block_size_1 + Function_7_block_size_2;
}

function initialize_CMD53_size_block(size_block)
{
    Function_0_block_size = size_block;
    Function_1_block_size = size_block;
    Function_2_block_size = size_block;
    Function_3_block_size = size_block;
    Function_4_block_size = size_block;
    Function_5_block_size = size_block;
    Function_6_block_size = size_block;
    Function_7_block_size = size_block;
}

function update_current_state(CMD, CMD_mode, transfer)
{
    if (current_state == "stby" && CMD == 7)
    {
        current_state = "tran";
        current_state_value = 4;
        return 0;
    }
    if (current_state == "tran" && (CMD == 6 || CMD == 17 || CMD == 18 || CMD == 30 || CMD == 56 || ((CMD == 13 || CMD == 22 || CMD == 51) && CMD_mode == 1)))
    {
        current_state = "data";
        current_state_value = 5;
        return 0;
    }
    else if (current_state == "tran" && (CMD == 24 || CMD == 25 || CMD == 26 || CMD == 27 || CMD == 42 || CMD == 56))
    {
        current_state = "rcv";
        current_state_value = 6;
        return 0;
    }
    else if (current_state == "tran" && (CMD == 28 || CMD == 29 || CMD == 38))
    {
        current_state = "prg";
        current_state_value = 7;
        return 0;
    }
    else if (current_state == "tran" && CMD == 7)
    {
        current_state = "stby";
        current_state_value = 3;
        return 0;
    }
    if (current_state == "data" && CMD == 12)
    {
        current_state = "tran";
        current_state_value = 4;
        return 0;
    }
    else if (current_state == "data" && CMD == 7)
    {
        current_state = "stby";
        current_state_value = 3;
        return 0;
    }
    if (current_state == "rcv" && CMD == 12)
    {
        current_state = "prg";
        current_state_value = 7;
        return 0;
    }
    if ((current_state == "prg" || current_state == "data") && transfer == "operation complete")
    {
        current_state = "tran";
        transfer = "operation not complete";
        current_state_value = 4;
        return 0;
    }
    if (current_state == "prg" && CMD == 7)
    {
        current_state = "dis";
        current_state_value = 8;
        return 0;
    }
    if (current_state == "dis" && CMD == 7)
    {
        current_state = "prg";
        current_state_value = 7;
        return 0;
    }
    if (current_state == "dis" && transfer == "operation complete")
    {
        current_state = "stby";
        current_state_value = 3;
        return 0;
    }
    else
    {
        current_state = current_state;
        return 0;
    }
}

function switch_cmd_number(current_state, cmd_number)
{
    var rng;
    switch (current_state)
    {
        case "stby":
        {
            if (SDIO_only == true)
            {
                rng = Math.floor(1.9*Math.random());
            }
            else
            {
                rng = Math.floor(4.9*Math.random());
            }
            switch (rng)
            {
                case 0 :
                {
                    return 7;
                }
                case 1 :
                {
                    return 3;
                }
                case 2 :
                {
                    return 10;
                }
                case 3 :
                {
                    return 9;
                }
                case 4 :
                {
                    return 4;
                }
            }
        }
        case "tran":
        {
            if (SDIO_only == true)
            {
                rng = Math.floor(14.9*Math.random());
            }
            else
            {
                rng = Math.floor(24.9*Math.random());
            }
            if (CMD_mode == 1)
            {
                if (SDIO_only == true)
                {
                    rng = Math.floor(1.9*Math.random());
                }
                else
                {
                    rng = Math.floor(5.9*Math.random());
                }
                switch (rng)
                {
                    case 0:
                    {
                        return 22;
                    }
                    case 1:
                    {
                        return 23;
                    }
                    case 2:
                    {
                        return 6;
                    }
                    case 3:
                    {
                        return 42;
                    }
                    case 4:
                    {
                        return 13;
                    }
                    case 5:
                    {
                        return 51;
                    }
                }
            }
            switch (rng)
            {
                case 0 :
                {
                    return 7;
                }
                case 1 :
                {
                    return 56;
                }
                case 2 :
                {
                    return 32;
                }
                case 3 :
                {
                    return 33;
                }
                case 4 :
                {
                    return 29;
                }
                case 5 :
                {
                    return 55;
                }
                case 6 :
                {
                    return 55;
                }
                case 7 :
                {
                    return 28;
                }
                case 8 :
                {
                    return 30;
                }
                case 9 :
                {
                    return 26;
                }
                case 10 :
                {
                    return 27;
                }
                case 11 :
                {
                    return 42;
                }
                case 12 :
                {
                    return 56;
                }
                case 13 :
                {
                    return 6;
                }
                case 14 :
                {
                    return 38;
                }
                case 15 :
                {
                    return 24;
                }
                case 16 :
                {
                    return 25;
                }
                case 17 :
                {
                    return 16;
                }
                case 18 :
                {
                    return 55;
                }
                case 19 :
                {
                    return 55;
                }
                case 20 :
                {
                    return 17;
                }
                case 21 :
                {
                    return 18;
                }
                case 22 :
                {
                    return 55;
                }
                case 23 :
                {
                    return 55;
                }
                case 24 :
                {
                    return 53;
                }
            }
        }
        case "rcv":
        {
            if (SDIO_only == true)
            {
                return 13;
            }
            else
            {
                return 12;
            }
        }
        case "prg":
        {
            return 7;
        }
        case "dis":
        {
            return 7;
        }
        case "data" :
        {
            if (SDIO_only == true)
            {
                return 13;
            }
            else
            {
                return 12;
            }
        }
    }
}


// Return CRC-7 from a bit array
function crc7(bit_array)
{
    // Transform the bits array into byte array
    var byte_array = [];
    var dec = 0;
    for (j=0; j<bit_array.length/8; j++)
    {
        for (i=0; i<8; i++)
        {
            dec += bit_array[(j*8)+i]*Math.pow(2,7-i);
        }
        byte_array.push(dec);
        dec = 0;
    }

    // generate a table value for all 256 possible byte values
    var i, j;
    var CRC7Poly = 0x89;
    var CRCTable = [];
    for (i = 0; i < 256; i++)
    {
        CRCTable[i] = (i & 0x80) ? i ^ CRC7Poly : i;
        for (j = 1; j < 8; j++)
        {
            CRCTable[i] <<= 1;
            if (CRCTable[i] & 0x80)
                CRCTable[i] ^= CRC7Poly;
        }
    }
    // returns the CRC-7 for a message of "length" bytes
    var CRC = 0;

    for (i = 0; i < byte_array.length; i++)
    {
        CRC = CRCTable[(CRC << 1) ^ byte_array[i]];
    }
    return CRC;
}


// Targets XMODEM
function crc16_1bit(bit_array, mode)
{
    if (mode == 1) // if we use the 4 data ports and the sync_decode work on 2 bit per channel so 1 by 1 byte (Data Packet Format for Wide Bus)
    {
        // Transform the bits array into byte array
        var byte_array = [];
        var dec = 0;
        var CRC16 = [];
        var eight_bit_array = [];
        for (z=0; z<4; z++)
        {
            byte_array = [];
            for (j=0; j<bit_array.length/(1*4); j++)
            {
                for (i=0; i<1; i++)
                {
                    eight_bit_array.push(bit_array[(j*1*4) + i + (z*1)]); // 1 represent the number of bit read by sync_decode on each channel, and 4 the number of DAT channels
                }
                if (eight_bit_array.length == 8)
                {
                    for (k=0; k<8; k++)
                    {
                        dec += eight_bit_array[k]*Math.pow(2,7-k);
                    }
                    eight_bit_array = [];
                    byte_array.push(dec);
                    dec = 0;
                }
            }
                var POLY = 0x1021, INIT = 0, XOROUT = 0;
                for(var crc = INIT, i = 0; i < byte_array.length; i++)
                {
                    crc = crc ^ (byte_array[i] << 8);
                    for (var j = 0; j < 8; j++)
                    {
                        crc = crc & 0x8000 ? crc << 1 ^ POLY : crc << 1;
                    }
                }
                CRC16.push((crc ^ XOROUT) & 0xFFFF);
            }
            return CRC16;
        }
        else
        {
            // Transform the bits array into byte array
            var byte_array = [];
            var dec = 0;
            for (j=0; j<bit_array.length/8; j++)
            {
                for (i=0; i<8; i++)
                {
                    dec += bit_array[(j*8)+i]*Math.pow(2,7-i);
                }
                byte_array.push(dec);
                dec = 0;
            }
            var POLY = 0x1021, INIT = 0, XOROUT = 0;
            for(var crc = INIT, i = 0; i < byte_array.length; i++)
            {
                crc = crc ^ (byte_array[i] << 8);
                for (var j = 0; j < 8; j++)
                {
                    crc = crc & 0x8000 ? crc << 1 ^ POLY : crc << 1;
                }
            }
            return (crc ^ XOROUT) & 0xFFFF;
        }

    };
