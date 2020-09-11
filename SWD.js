/* Protocol meta info:
<NAME> SWD </NAME>
<DESCRIPTION>
SW-DP decoder according to the ARM® Debug Interface Architecture Specification ADIv6.0.
About the APACC, it can decode the MEM-AP and the JTAG-AP, others are consider unknown.
</DESCRIPTION>
<VERSION> 1.0 </VERSION>
<AUTHOR_NAME> Corentin Maravat </AUTHOR_NAME>
<AUTHOR_URL> contact@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright Ikalogic SAS </COPYRIGHT>
<LICENSE> This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V1.0:  Initial release.
</RELEASE_NOTES>
*/

/*Sources : Specification du protocole et des registres 6.0 Version : https://static.docs.arm.com/ihi0074/a/debug_interface_v6_0_architecture_specification_IHI0074A.pdf
Spec mais Version 5.0 to 5.2 : https://static.docs.arm.com/ihi0031/c/IHI0031C_debug_interface_as.pdf#page=123&zoom=100,125,80
Blog qui parle du SWD, avec des exemples de trame et on voit bien le changement de front entre l'hote et la cible : https://www.cnblogs.com/shangdawei/p/4748751.html
*/


//Decoder GUI
function on_draw_gui_decoder()
{
  //Define decoder configuration GUI
  ScanaStudio.gui_add_ch_selector("ch_io","SWDIO Channel","SWDIO");
  ScanaStudio.gui_add_ch_selector("ch_clk","SWDCLK Channel","SWDCLK");
  ScanaStudio.gui_add_baud_selector("baud","Baud rate",10000);
  ScanaStudio.gui_add_new_tab("SWD Mode configuration",false);
  ScanaStudio.gui_add_combo_box("protocol_version", "SWD protocol Version");
  ScanaStudio.gui_add_item_to_combo_box("v2", true);
  ScanaStudio.gui_add_item_to_combo_box("v1");
  ScanaStudio.gui_add_text_input("turnaround_period","Length of the turnaround period","1");
  ScanaStudio.gui_add_info_label("Default value is 1. Call DLCR Register if you want to change the value during the capture.");
  ScanaStudio.gui_add_check_box("access_dpidr_change_state","Access to the DPIDR change the protocol state",false);
  ScanaStudio.gui_add_info_label("If the target detects a valid read of the DP DPIDR register,  the target"
  +" leaves the protocol error state, and gives an OK response. ");
  ScanaStudio.gui_add_new_selectable_containers_group("access_port","Select the Access Port")
  ScanaStudio.gui_add_new_container("MEM-AP",true);
  ScanaStudio.gui_add_check_box("large_data_extension","Large Data Extension Implemented",false);
  // ScanaStudio.gui_add_info_label("Implementing this extension changes the format of CSW/DRW/BD0-BD3/DAR0-DAR255/CFG");
  ScanaStudio.gui_add_check_box("packet_transfers","Packet Transfers Implemented",false);
  ScanaStudio.gui_add_check_box("bytes_lanes","Bytes Lanes Implemented",false);
  // ScanaStudio.gui_add_info_label("Support Data Bus access sizes smaller than word size (32 bits)");
  ScanaStudio.gui_add_check_box("large_physical_address_extension","Large Physical Address Extension Implemented",false);
  // ScanaStudio.gui_add_info_label("Implementing this extension changes the format of BASE/CFG/CSW/DRW/TAR");
  ScanaStudio.gui_add_check_box("barrier_operation_extension","Barrier Operation Extension Implemented",false);
  ScanaStudio.gui_end_container();
  ScanaStudio.gui_add_new_container("JTAG-AP",false);
  ScanaStudio.gui_end_container();
  ScanaStudio.gui_end_selectable_containers_group();

  ScanaStudio.gui_end_tab();


  //Add other gui functions...
}

function reload_dec_gui_values()
{
    //get GUI values
    ch_io = ScanaStudio.gui_get_value("ch_io");
    ch_clk = ScanaStudio.gui_get_value("ch_clk");
    Protocol_version = Number(ScanaStudio.gui_get_value("protocol_version"));
    Turnaround_period = Number(ScanaStudio.gui_get_value("turnaround_period"));
    DPIDR_exit_error_state = ScanaStudio.gui_get_value("access_dpidr_change_state");
    AP_Memory = Number(ScanaStudio.gui_get_value("access_port"));
    if (AP_Memory == 0)
    {
        AP_Memory = "MEM-AP";
        Large_data_extension_implemented = ScanaStudio.gui_get_value("large_data_extension");
        Packet_transfers_implemented = ScanaStudio.gui_get_value("packet_transfers");
        Bytes_lanes_implemented = ScanaStudio.gui_get_value("bytes_lanes");
        Barrier_operation_extension_implemented = ScanaStudio.gui_get_value("barrier_operation_extension");
        Large_physical_adress_extension_implemented = ScanaStudio.gui_get_value("large_physical_address_extension");
    }
    else
    {
        AP_Memory = "JTAG-AP";
    }
}


//Evaluate decoder GUI
function on_eval_gui_decoder()
{
    if (ScanaStudio.gui_get_value("turnaround_period") > 4)
    {
        return "Error, turnaround period can't be larger than 4 clock cycle."
    }
    if(Number(ScanaStudio.gui_get_value("baud")*8) >= (ScanaStudio.get_capture_sample_rate()) )
    {
        return "Selected bauderate is too high compared to the sampling rate you chose. Bauderate should be at least 8 times lower than the sampling rate.";
    }
  return ""; //All good.
}

//Global variables
var sampling_rate;
var state_machine;
var ch_io;
var ch_clk;
var nbits;
var io_channel = [];
var item_display = [];
var parity_array = [];
var last_trans = false;
var driver = "Host";
var last_RnW = "";
var Turnaround_period;
var ACK = "";
var item_content = "";
var last_APnDP = "";
// Variables used for AP Read
var last_Register_name = "";
var last_Register_name_2 = "";
var last_AP_Adress = 0;
var last_AP_Adress_2 = 0;
var last_Adress = 0;
var last_Adress_2 = 0;
// Variables for the request
var APnDP = "";
var RnW = "";
var Adress = 0;
var AP_Adress = 0;
var DP_BANK_SEL = -1; //Undefined
var SELECT_ADDR = 0;
var SELECT1_ADDR = 0;
var SELECT_string_hexa = "";
var Register_name = "";
var DP_Version = 3;
var Protocol_version = 0;
var Large_data_extension_implemented = false;
var Packet_transfers_implemented = false;
var Bytes_lanes_implemented = false;
var Barrier_operation_extension_implemented = false;
var DPIDR_exit_error_state = false;
var CSW_ERRNPASS_implemented = true;
var CSW_ERRSTOP_implemented = true;
var TRR_implemented = true;
var AP_Memory = "MEM-AP";
var TAR_Adress_LSB = 0;
var TAR_Adress_MSB = 0;
var TAR_Adress = [];
var TAR_string_hexa = "";
var Protocol_State = "Reset"; // "Reset"(after a line reset at the start of after a protocol error)/"Error"(After an ack error or Request Parity/Stop/Park bit error)/"Transfer" (No problem)
var reset = true; // To check if we're on the line reset state
var first = true; // Know if it's the first sync_decode after entering in ENUM_STATE_RESET
var AddrInc = 0; // Not incremented
var DARSIZE = 10; // DAR register implemented
// PIDR variable
var PART_0 = 0;
var PART_1 = 0;
// ACK WAIT or FAULT variables
var ORUNDETECT = 0; // overrun is disable
// JTAG_AP variables
var WFIFOCNT = 0;
var SERACTV = 0;
// demo signal
var rng_RnW = 0;
var rng_A = 0;
var clk_lvl = 0;
var rng_data = 0;
var second_trn = false;


//decoder state
const   ENUM_STATE_REQUEST = 0,
        ENUM_STATE_ACK = 1,
        ENUM_STATE_DATA_TRANSFER = 2,
        ENUM_STATE_RESET = 4,
        ENUM_STATE_UNDEFINED = 10;

const   SWD_PROTOCOL_VERSION_2 = 0,
        SWD_PROTOCOL_VERSION_1 = 1;


function on_decode_signals(resume)
{
  if (!resume) //If resume == false, it's the first call to this function.
  {
      //initialization code goes here, ex:
      sampling_rate = ScanaStudio.get_capture_sample_rate();
      reload_dec_gui_values();
      io_channel.push(ch_io);
      var trs_clk = ScanaStudio.trs_reset(ch_clk);
      trs_clk = ScanaStudio.trs_get_next(ch_clk);
      var tmp_trs_sample_index;
      tmp_trs_sample_index = trs_clk.sample_index;
      while( (tmp_trs_sample_index == trs_clk.sample_index) && (ScanaStudio.trs_is_not_last(ch_clk) == true) )
      {
          trs_clk = ScanaStudio.trs_get_next(ch_clk);
      }
      var trs_io = ScanaStudio.trs_reset(ch_io);
      trs_io = ScanaStudio.trs_get_next(ch_io);
      tmp_trs_sample_index = trs_io.sample_index;
      while( (tmp_trs_sample_index == trs_io.sample_index) && (ScanaStudio.trs_is_not_last(ch_io) == true) )
      {
          trs_io = ScanaStudio.trs_get_next(ch_io);
      }
      // ScanaStudio.console_info_msg("trs_io.smaple_index",trs_io.sample_index);
      //init global variables
      swd_simple = sync_decode_v2(io_channel,trs_clk.sample_index + 1,5);
      state_machine = ENUM_STATE_REQUEST;
      DP_BANK_SEL = 0;
      AP_Adress = 0;
  }//end if !resume
  else
  {
      //ScanaStudio.console_info_msg("Decoding resumed");
  }

    while (ScanaStudio.abort_is_requested() == false)
    {
        // ScanaStudio.console_info_msg(".");
        if (!ScanaStudio.trs_is_not_last(ch_io))
        {
            break;
        }
        // ScanaStudio.console_info_msg("Protocol_State : " + Protocol_State + ", state_machine : " + state_machine , swd_simple.end_sample);
        switch(state_machine)
        {
            case ENUM_STATE_REQUEST : // Request to read/Write an AP/DP register of the target
            {
                driver = "Host"; // The host always drive the line for the request
                last_Protocol_State = Protocol_State;
                if (Protocol_State == "Reset" || Protocol_State == "Error") // If it's the first start
                {
                    if (Protocol_State == "Error")
                    {
                        // Check if there is a line reset
                        trs_clk  = ScanaStudio.trs_get_before(ch_clk, swd_simple.start_sample + 1);
                        //if the error come from the ACK anyway we instantly go to ENUM_STATE_RESET
                        nbits = 50;
                        reset_sequence = sync_decode_v2(io_channel,trs_clk.sample_index + 1,nbits);
                        reset = true;
                        for (i=0; i<50; i++)
                        {
                            if(reset_sequence.signed_words[i] == 0)
                            {
                                reset = false;
                            }
                        }
                        if (reset == true)
                        {
                            ScanaStudio.dec_item_new(ch_io,reset_sequence.start_sample + 1,reset_sequence.end_sample - 1);
                            ScanaStudio.dec_item_add_content("Reset Sequence, go back to normal state");
                            ScanaStudio.dec_item_end();
                            //Packet View
                            ScanaStudio.packet_view_add_packet(true,ch_io,reset_sequence.start_sample,reset_sequence.end_sample,"RESET SEQUENCE","50 clocks with SWDIOTMS HIGH",ScanaStudio.PacketColors.Preamble.Title, ScanaStudio.PacketColors.Preamble.Content);
                            // Idle cycle
                            trs_io = ScanaStudio.trs_get_before(ch_io,reset_sequence.start_sample);
                            tmp_trs_sample_index = trs_io.sample_index;
                            while( (tmp_trs_sample_index == trs_io.sample_index) && (ScanaStudio.trs_is_not_last(ch_io) == true) )
                            {
                                trs_io = ScanaStudio.trs_get_next(ch_io);
                            }
                            var start_idle_cycles = trs_io.sample_index;
                            trs_io = ScanaStudio.trs_get_next(ch_io); // rising edge because the last one was a falling
                            ScanaStudio.dec_item_new(ch_io,start_idle_cycles + 1,trs_io.sample_index - 1);
                            ScanaStudio.dec_item_add_content("Idle Cycles");
                            ScanaStudio.dec_item_end();
                            // Display the driver on the clk line
                            ScanaStudio.dec_item_new(ch_clk,reset_sequence.start_sample + 1,trs_io.sample_index - 1);
                            ScanaStudio.dec_item_add_content("Driver : Host");
                            ScanaStudio.dec_item_end();
                            //Packet View
                            ScanaStudio.packet_view_add_packet(false,ch_io,start_idle_cycles,trs_io.sample_index - 1,"RESET SEQUENCE","IDLE CYCLES",ScanaStudio.PacketColors.Misc.Title, ScanaStudio.PacketColors.Misc.Content);
                            Protocol_State = "Reset";
                            DP_BANK_SEL = 0;
                            Turnaround_period = 1;
                            break;
                        }
                        else if (reset == false) // If there isn't reset sequence, we search for DPIDR
                        {
                            //TEST IF THE REQUEST IS DPIDR
                            nbits = 8;
                            swd_simple = sync_decode_v2(io_channel,trs_clk.sample_index + 1,nbits);
                            if (swd_simple.unsigned_words == 165) // Correct DPIDR Request
                            {
                                tmp_trs_sample_index = trs_clk.sample_index;
                                while( (tmp_trs_sample_index == trs_clk.sample_index) && (ScanaStudio.trs_is_not_last(ch_clk) == true) )
                                {
                                    trs_clk = ScanaStudio.trs_get_next(ch_clk);
                                }
                                var protocol_error_end = trs_clk.sample_index;
                                // Display protocol error
                                ScanaStudio.dec_item_new(ch_io,protocol_error_start + 1, protocol_error_end - 1);
                                ScanaStudio.dec_item_add_content("Protocol error");
                                ScanaStudio.dec_item_end();
                                // Display that we found a correct DPIDR and we go
                                var end_protocol_error = dec_item_new_v2 (ch_io, swd_simple)[1];
                                ScanaStudio.dec_item_add_content("Correct DPIDR Request, go back to normal state");
                                display_sample(swd_simple);
                                ScanaStudio.dec_item_end();
                                // Display the driver on the clk line
                                ScanaStudio.dec_item_new(ch_clk,protocol_error_start + 1,end_protocol_error - 1)
                                dec_item_new_v2 (ch_clk, swd_simple);
                                ScanaStudio.dec_item_add_content("Driver : Host");
                                ScanaStudio.dec_item_end();
                                // Packet view
                                ScanaStudio.packet_view_add_packet(true,ch_io,protocol_error_start,protocol_error_end,"REQUEST","Read, DP, DPIDR",ScanaStudio.get_channel_color(ch_io),ScanaStudio.get_channel_color(ch_io));
                                // Update variables
                                Protocol_State = "Transfer";
                                Register_name = "DPIDR";
                                RnW = "Read";
                                APnDP = "DP";
                                Adress = 0;
                                state_machine = ENUM_STATE_ACK;
                                break;
                            }
                            break;
                        }
                    }//end if (Protocol_State == "Error")
                    else //start if (Protocol_State == "Reset")
                    {
                        if (Register_name == "TARGETSEL")
                        {
                            // Check if there is a line reset
                            trs_clk = ScanaStudio.trs_get_before(ch_clk,swd_simple.start_sample + 1);
                            nbits = 50;
                            reset_sequence = sync_decode_v2(io_channel,swd_simple.start_sample + 1,nbits);
                            reset = true;
                            for (i=0; i<50; i++)
                            {
                                if(reset_sequence.signed_words[i] == 0)
                                {
                                    reset = false;
                                }
                            }
                            if (reset == true)
                            {
                                ScanaStudio.dec_item_new(ch_io,reset_sequence.start_sample + 1,reset_sequence.end_sample - 1);
                                ScanaStudio.dec_item_add_content("Reset Sequence, go back to normal state");
                                ScanaStudio.dec_item_end();
                                // Packet view
                                ScanaStudio.packet_view_add_packet(true,ch_io,reset_sequence.start_sample,reset_sequence.end_sample,"RESET SEQUENCE","50 clocks with SWDIOTMS HIGH",ScanaStudio.PacketColors.Preamble.Title,ScanaStudio.PacketColors.Preamble.Content);
                                // Idle cycle
                                trs_io = ScanaStudio.trs_get_next(ch_io); // falling edge because the last one was a rising
                                var start_idle_cycles = trs_io.sample_index;
                                trs_io = ScanaStudio.trs_get_next(ch_io); // rising edge because the last one was a falling
                                ScanaStudio.dec_item_new(ch_io,start_idle_cycles + 1,trs_io.sample_index - 1);
                                ScanaStudio.dec_item_add_content("Idle Cycles");
                                ScanaStudio.dec_item_end();
                                // Display the driver on the clk line
                                var test = ScanaStudio.dec_item_new(ch_io,reset_sequence.start_sample,trs_io.sample_index - 1);
                                ScanaStudio.dec_item_add_content("Driver : Host");
                                ScanaStudio.dec_item_end();
                                ScanaStudio.packet_view_add_packet(false,ch_io,start_idle_cycles,trs_io.sample_index - 1,"RESET SEQUENCE","IDLE CYCLES",ScanaStudio.PacketColors.Misc.Title,ScanaStudio.PacketColors.Misc.Content);
                                Protocol_State = "Reset";
                                DP_BANK_SEL = 0;
                                Turnaround_period = 1;
                                swd_simple.end_sample = trs_io.sample_index;
                            }
                            else // if there isn't a reset sequence
                            {
                                // If there is idles cycles after the transaction
                                nbits = 1;
                                idle_cycles = sync_decode_v2(io_channel, swd_simple.end_sample + 1,nbits);
                                if (idle_cycles.unsigned_words == 0)
                                {
                                    trs_io = ScanaStudio.trs_get_before(ch_io,idle_cycles.start_sample + 1); // falling edge
                                    tmp_trs_sample_index = trs_io.sample_index;
                                    while( (tmp_trs_sample_index == trs_io.sample_index) && (ScanaStudio.trs_is_not_last(ch_io) == true) )
                                    {
                                        trs_io = ScanaStudio.trs_get_next(ch_io); // rising edge
                                    }
                                    trs_clk = ScanaStudio.trs_get_before(ch_clk,idle_cycles.start_sample - 1); //falling edge
                                    var start_item = trs_clk.sample_index;
                                    var nb_trs = 0;
                                    while (trs_clk.sample_index <= trs_io.sample_index - 1)
                                    {
                                        tmp_trs_sample_index = trs_clk.sample_index;
                                        while( (tmp_trs_sample_index == trs_clk.sample_index) && (ScanaStudio.trs_is_not_last(ch_clk) == true) )
                                        {
                                            trs_clk = ScanaStudio.trs_get_next(ch_clk);
                                        }
                                        nb_trs++;
                                    }
                                    if (nb_trs >= 16)
                                    {
                                        ScanaStudio.dec_item_new(ch_io,start_item + 1,trs_io.sample_index - 1);
                                        ScanaStudio.dec_item_add_content("Idles Cycles : the clock can be stopped");
                                        ScanaStudio.dec_item_add_content("Idles Cycles");
                                        ScanaStudio.dec_item_end();
                                    }
                                    else
                                    {
                                        ScanaStudio.dec_item_new(ch_io,start_item + 1,trs_io.sample_index - 1);
                                        ScanaStudio.dec_item_add_content("Idles Cycles before another packet header");
                                        ScanaStudio.dec_item_add_content("Idles Cycles");
                                        ScanaStudio.dec_item_end();
                                    }
                                    // Display the driver
                                    ScanaStudio.dec_item_new(ch_clk,start_item + 1,trs_io.sample_index - 1);
                                    ScanaStudio.dec_item_add_content("Driver : Host");
                                    ScanaStudio.dec_item_end();
                                    // Packet view
                                    ScanaStudio.packet_view_add_packet(false,ch_io,start_item + 1,trs_io.sample_index - 1,"Idles Cycles","Idles Cycles",ScanaStudio.PacketColors.Misc.Title,ScanaStudio.PacketColors.Misc.Content);
                                    swd_simple.end_sample = trs_io.sample_index;
                                    // Check if there is a line reset
                                    trs_clk  = ScanaStudio.trs_get_before(ch_clk, trs_io.sample_index + 1);
                                    nbits = 50;
                                    reset_sequence = sync_decode_v2(io_channel,trs_clk.sample_index + 1,nbits);
                                    reset = true;
                                    for (i=0; i<50; i++)
                                    {
                                        if(reset_sequence.signed_words[i] == 0)
                                        {
                                            reset = false;
                                        }
                                    }
                                    if (reset == true)
                                    {
                                        ScanaStudio.dec_item_new(ch_io,reset_sequence.start_sample + 1,reset_sequence.end_sample - 1);
                                        ScanaStudio.dec_item_add_content("Reset Sequence, go back to normal state");
                                        ScanaStudio.dec_item_end();
                                        //Packet View
                                        ScanaStudio.packet_view_add_packet(true,ch_io,reset_sequence.start_sample,reset_sequence.end_sample,"RESET SEQUENCE","50 clocks with SWDIOTMS HIGH",ScanaStudio.PacketColors.Preamble.Title,ScanaStudio.PacketColors.Preamble.Content);
                                        // Idle cycle
                                        trs_io = ScanaStudio.trs_get_before(ch_io,reset_sequence.start_sample);
                                        tmp_trs_sample_index = trs_io.sample_index;
                                        while( (tmp_trs_sample_index == trs_io.sample_index) && (ScanaStudio.trs_is_not_last(ch_io) == true) )
                                        {
                                            trs_io = ScanaStudio.trs_get_next(ch_io);
                                        }
                                        var start_idle_cycles = trs_io.sample_index;
                                        trs_io = ScanaStudio.trs_get_next(ch_io); // rising edge because the last one was a falling
                                        ScanaStudio.dec_item_new(ch_io,start_idle_cycles + 1,trs_io.sample_index - 1);
                                        ScanaStudio.dec_item_add_content("Idle Cycles");
                                        ScanaStudio.dec_item_end();
                                        // Display the driver on the clk line
                                        ScanaStudio.dec_item_new(ch_clk,reset_sequence.start_sample + 1,trs_io.sample_index - 1);
                                        ScanaStudio.dec_item_add_content("Driver : Host");
                                        ScanaStudio.dec_item_end();
                                        //Packet View
                                        ScanaStudio.packet_view_add_packet(false,ch_io,start_idle_cycles,trs_io.sample_index - 1,"RESET SEQUENCE","IDLE CYCLES",ScanaStudio.PacketColors.Misc.Title,ScanaStudio.PacketColors.Misc.Content);
                                        Protocol_State = "Reset";
                                        DP_BANK_SEL = 0;
                                        Turnaround_period = 1;
                                        swd_simple.end_sample = trs_io.sample_index;
                                    }
                                }
                                else // if (idle_cycles.unsigned_words != 0)
                                {
                                    // Check if there is a line reset
                                    trs_clk  = ScanaStudio.trs_get_before(ch_clk, swd_simple.start_sample + 1);
                                    nbits = 50;
                                    reset_sequence = sync_decode_v2(io_channel,trs_clk.sample_index + 1,nbits);
                                    reset = true;
                                    for (i=0; i<50; i++)
                                    {
                                        if(reset_sequence.signed_words[i] == 0)
                                        {
                                            reset = false;
                                        }
                                    }
                                    if (reset == true)
                                    {
                                        ScanaStudio.dec_item_new(ch_io,reset_sequence.start_sample + 1,reset_sequence.end_sample - 1);
                                        ScanaStudio.dec_item_add_content("Reset Sequence, go back to normal state");
                                        ScanaStudio.dec_item_end();
                                        //Packet View
                                        ScanaStudio.packet_view_add_packet(true,ch_io,reset_sequence.start_sample,reset_sequence.end_sample,"RESET SEQUENCE","50 clocks with SWDIOTMS HIGH",ScanaStudio.PacketColors.Preamble.Title,ScanaStudio.PacketColors.Preamble.Content);
                                        // Idle cycle
                                        trs_io = ScanaStudio.trs_get_before(ch_io,reset_sequence.start_sample);
                                        tmp_trs_sample_index = trs_io.sample_index;
                                        while( (tmp_trs_sample_index == trs_io.sample_index) && (ScanaStudio.trs_is_not_last(ch_io) == true) )
                                        {
                                            trs_io = ScanaStudio.trs_get_next(ch_io);
                                        }
                                        var start_idle_cycles = trs_io.sample_index;
                                        trs_io = ScanaStudio.trs_get_next(ch_io); // rising edge because the last one was a falling
                                        ScanaStudio.dec_item_new(ch_io,start_idle_cycles + 1,trs_io.sample_index - 1);
                                        ScanaStudio.dec_item_add_content("Idle Cycles");
                                        ScanaStudio.dec_item_end();
                                        // Display the driver on the clk line
                                        ScanaStudio.dec_item_new(ch_clk,reset_sequence.start_sample + 1,trs_io.sample_index - 1);
                                        ScanaStudio.dec_item_add_content("Driver : Host");
                                        ScanaStudio.dec_item_end();
                                        //Packet View
                                        ScanaStudio.packet_view_add_packet(false,ch_io,start_idle_cycles,trs_io.sample_index - 1,"RESET SEQUENCE","IDLE CYCLES",ScanaStudio.PacketColors.Misc.Title,ScanaStudio.PacketColors.Misc.Content);
                                        Protocol_State = "Reset";
                                        DP_BANK_SEL = 0;
                                        Turnaround_period = 1;
                                        swd_simple.end_sample = trs_io.sample_index;
                                    }//end if (reset == true)
                                }//end if (idle_cycles.unsigned_words != 0)
                            }//end if (reset != true)
                            // Start bit
                            nbits = 1;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample + 1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            swd_value = Number(swd_simple.unsigned_words);
                            if (swd_value == 0)
                            {
                                dec_item_new_v2(ch_io, swd_simple);
                                ScanaStudio.dec_item_add_content("Start");
                                ScanaStudio.dec_item_add_content("S");
                                ScanaStudio.dec_item_add_sample_point(swd_simple.start_sample,"P")
                                ScanaStudio.dec_item_emphasize_error();
                                state_machine = ENUM_STATE_REQUEST;
                                trs_io.value = -1;
                                item_display = [];
                                parity_array = [];
                                ScanaStudio.dec_item_end();
                                //Packet View
                                ScanaStudio.packet_view_add_packet(true,ch_io,swd_simple.start_sample,swd_simple.end_sample,"SWD","CH_IO",ScanaStudio.get_channel_color(ch_io),ScanaStudio.get_channel_color(ch_io));
                                break;
                            }
                            //Packet View
                            ScanaStudio.packet_view_add_packet(true,ch_io,swd_simple.start_sample,swd_simple.end_sample,"SWD","CH_IO",ScanaStudio.get_channel_color(ch_io),ScanaStudio.get_channel_color(ch_io));
                            var start_request = dec_item_new_v2 (ch_io, swd_simple)[0];
                            dec_item_new_v2 (ch_io, swd_simple);
                            ScanaStudio.dec_item_add_content("Start");
                            ScanaStudio.dec_item_add_content("S");
                            display_sample(swd_simple);
                            ScanaStudio.dec_item_end();
                            packet_view_add_packet_v2(ch_io,swd_simple,"Start","Request","Wrap");
                            trs_io.value = -1;
                            //Read APnDP bit
                            parity_array = [];
                            nbits = 1;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            swd_value = Number(swd_simple.unsigned_words);
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            dec_item_new_v2(ch_io,swd_simple);
                            if (swd_value == 1)
                            {
                                packet_string = "AP (Access Port Register)";
                                APnDP = "AP";
                                ScanaStudio.dec_item_add_content("APnDP : AP (Access Port Register)");
                                ScanaStudio.dec_item_add_content("APnDP : AP");
                                ScanaStudio.dec_item_add_content("AP");
                            }
                            else
                            {
                                packet_string = "DP (Debug Port Register)";
                                APnDP = "DP";
                                ScanaStudio.dec_item_add_content("APnDP : DP (Debug Port Register)");
                                ScanaStudio.dec_item_add_content("APnDP : DP");
                                ScanaStudio.dec_item_add_content("DP");
                            }
                            display_sample(swd_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_io,swd_simple,"APnDP",packet_string,"Data");
                            //Read RnW bit
                            nbits = 1;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            swd_value = Number(swd_simple.unsigned_words);
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            dec_item_new_v2(ch_io,swd_simple);
                            if (swd_value == 1)
                            {
                                packet_string = "Read";
                                RnW = "Read";
                                ScanaStudio.dec_item_add_content("RnW : Read");
                                ScanaStudio.dec_item_add_content("Read");
                            }
                            else
                            {
                                packet_string = "Write";
                                RnW = "Write";
                                ScanaStudio.dec_item_add_content("RnW : Write");
                                ScanaStudio.dec_item_add_content("Write");
                            }
                            display_sample(swd_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_io,swd_simple,"RnW",packet_string,"Data");
                            //Read A[2:3] bit
                            nbits = 2;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            swd_value = Number(swd_simple.unsigned_words);
                            Adress = swd_value * 4;
                            get_register_name(RnW, Adress, APnDP, DP_BANK_SEL);
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            dec_item_new_v2(ch_io,swd_simple);
                            display_register_name();
                            ScanaStudio.dec_item_add_content("Adress field : 0x" + Adress);
                            ScanaStudio.dec_item_add_content("0x" + pad(Adress.toString(16),1));
                            display_sample(swd_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_io,swd_simple,"A[2:3]",packet_string,"Data");
                            //Read parity bit
                            nbits = 1;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            swd_value = Number(swd_simple.unsigned_words);
                            parity_calculated = get_parity(parity_array);
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            dec_item_new_v2(ch_io,swd_simple);
                            if (swd_value == parity_calculated)
                            {
                                packet_string = "OK";
                                types = "Check";
                                ScanaStudio.dec_item_add_content("Parity bit OK");
                                ScanaStudio.dec_item_add_content("OK");
                            }
                            else
                            {
                                packet_string = "NOT OK";
                                types = "Error";
                                if ((Protocol_version == SWD_PROTOCOL_VERSION_2) || DPIDR_exit_error_state == false || (Protocol_State == "Error")) // If we're in these case you instantly go Lockout State and search a line reset to go Reset State
                                {
                                    Protocol_State = "Lockout";
                                }
                                else if (Protocol_State == "Transfer" || Protocol_State == "Reset")
                                {
                                    Protocol_State = "Error";
                                }
                                ScanaStudio.dec_item_add_content("Parity bit NOT OK");
                                ScanaStudio.dec_item_add_content("NOT OK");
                                ScanaStudio.dec_item_emphasize_error();
                            }
                            display_sample_0_1(swd_simple, item_display);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_io,swd_simple,"Parity bit",packet_string,types);
                            //Read Stop bit
                            nbits = 1;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            swd_value = Number(swd_simple.unsigned_words);
                            dec_item_new_v2(ch_io,swd_simple);
                            if (swd_value == 0)
                            {
                                packet_string = "Stop";
                                types = "Wrap";
                                ScanaStudio.dec_item_add_content("Stop");
                                ScanaStudio.dec_item_add_content("S");
                            }
                            else
                            {
                                packet_string = "Stop bit value should be LOW";
                                types = "Error";
                                if ((Protocol_version == SWD_PROTOCOL_VERSION_2) || DPIDR_exit_error_state == false || (Protocol_State == "Error"))
                                {
                                    Protocol_State = "Lockout";
                                }
                                else if (Protocol_State == "Transfer" || Protocol_State == "Reset")
                                {
                                    Protocol_State = "Error";
                                }
                                ScanaStudio.dec_item_add_content("Stop");
                                ScanaStudio.dec_item_add_content("S");
                                ScanaStudio.dec_item_emphasize_error();
                            }
                            display_sample(swd_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_io,swd_simple,"Stop",packet_string,types);
                            //Read Park bit
                            nbits = 1;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            swd_value = Number(swd_simple.unsigned_words);
                            var protocol_error_start = dec_item_new_v2(ch_io,swd_simple)[1]; // protocol_error start take the value of the sample of the end of this item
                            if (swd_value == 1)
                            {
                                packet_string = "Park bit";
                                types = "Wrap";
                                ScanaStudio.dec_item_add_content("Park bit");
                                ScanaStudio.dec_item_add_content("P");
                            }
                            else
                            {
                                packet_string = "Park bit value should be HIGH";
                                types = "Error";
                                if ((Protocol_version == SWD_PROTOCOL_VERSION_2) || DPIDR_exit_error_state == false || (Protocol_State == "Error"))
                                {
                                    Protocol_State = "Lockout";
                                }
                                else if (Protocol_State == "Transfer" || Protocol_State == "Reset")
                                {
                                    Protocol_State = "Error";
                                }
                                ScanaStudio.dec_item_add_content("Park bit should be HIGH");
                                ScanaStudio.dec_item_add_content("P");
                                ScanaStudio.dec_item_emphasize_error();
                            }
                            display_sample(swd_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_io,swd_simple,"Park bit",packet_string,types);
                            var end_request = protocol_error_start;
                            // Display the driver
                            ScanaStudio.dec_item_new(ch_clk,start_request + 1,end_request - 1);
                            ScanaStudio.dec_item_add_content("Driver : Host");
                            ScanaStudio.dec_item_end();
                            while (trs_io.sample_index < swd_simple.end_sample)
                            {
                                if (!ScanaStudio.trs_is_not_last(ch_io))
                                {
                                    break;
                                }
                                trs_io = ScanaStudio.trs_get_next(ch_io);
                            }
                            if (Protocol_State == "Reset" && Register_name == "DPIDR")
                            {
                                Protocol_State = "Transfer";
                                state_machine = ENUM_STATE_ACK;
                            }
                            else if (Protocol_State == "Reset" && Register_name == "TARGETSEL")
                            {
                                state_machine = ENUM_STATE_ACK;
                            }
                            else if (Protocol_State == "Reset" && Protocol_version == SWD_PROTOCOL_VERSION_2)
                            // If the SW-DP implements SWD protocol version 2, it must enter the lockout state after a single protocol error
                            // immediately after a line reset. However, if the first packet request detected by the target following line reset is valid
                            // it can then revert to entering the lockout state after an IMPLEMENTATION DEFINED number of protocol errors.
                            {
                                Protocol_State = "Transfer";
                                state_machine = ENUM_STATE_ACK;
                            }
                            else if (Protocol_State == "Error")
                            {
                                state_machine = ENUM_STATE_REQUEST;
                            }
                            else if (Protocol_State == "Error" && Register_name == "DPIDR" && DPIDR_exit_error_state == true)
                            {
                                Protocol_State = "Transfer";
                                state_machine = ENUM_STATE_ACK;
                            }
                            else if (Protocol_State == "Lockout")
                            {
                                state_machine = ENUM_STATE_RESET;
                            }
                            break;
                        } //end if the last access was the TARGETSEL Register
                        else // if the last access wasn't the TARGETSEL Register
                        {
                            if (trs_io.value == 1) //(rising edge)
                            {
                                // Check if there is a line reset
                                nbits = 50;
                                reset_sequence = sync_decode_v2(io_channel,trs_io.sample_index,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_io();
                                    break;
                                }
                                reset = true;
                                for (i=0; i<50; i++)
                                {
                                    if(reset_sequence.signed_words[i] == 0)
                                    {
                                        reset = false;
                                    }
                                }
                                if (reset == true)
                                {
                                    ScanaStudio.dec_item_new(ch_io,reset_sequence.start_sample + 1,reset_sequence.end_sample - 1);
                                    ScanaStudio.dec_item_add_content("Reset Sequence, go back to normal state");
                                    ScanaStudio.dec_item_end();
                                    // Packet view
                                    ScanaStudio.packet_view_add_packet(true,ch_io,reset_sequence.start_sample,reset_sequence.end_sample,"RESET SEQUENCE","50 clocks with SWDIOTMS HIGH",ScanaStudio.PacketColors.Preamble.Title,ScanaStudio.PacketColors.Preamble.Content);
                                    // Idle cycle
                                    trs_io = ScanaStudio.trs_get_next(ch_io); // falling edge because the last one was a rising
                                    var start_idle_cycles = trs_io.sample_index;
                                    trs_io = ScanaStudio.trs_get_next(ch_io); // rising edge because the last one was a falling
                                    ScanaStudio.dec_item_new(ch_io,start_idle_cycles + 1,trs_io.sample_index - 1);
                                    ScanaStudio.dec_item_add_content("Idle Cycles");
                                    ScanaStudio.dec_item_end();
                                    // Display the driver on the clk line
                                    var test = ScanaStudio.dec_item_new(ch_io,reset_sequence.start_sample,trs_io.sample_index - 1);
                                    ScanaStudio.dec_item_add_content("Driver : Host");
                                    ScanaStudio.dec_item_end();
                                    ScanaStudio.packet_view_add_packet(false,ch_io,start_idle_cycles,trs_io.sample_index - 1,"RESET SEQUENCE","IDLE CYCLES",ScanaStudio.PacketColors.Misc.Title,ScanaStudio.PacketColors.Misc.Content);
                                    Protocol_State = "Reset";
                                    DP_BANK_SEL = 0;
                                    Turnaround_period = 1;
                                }
                                // Start of the Request

                                parity_array = [];
                                nbits = 1;
                                swd_simple = sync_decode_v2(io_channel,trs_io.sample_index,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_io();
                                    break;
                                }
                                swd_value = Number(swd_simple.unsigned_words);
                                if (swd_value == 0)
                                {
                                    dec_item_new_v2(ch_io, swd_simple);
                                    ScanaStudio.dec_item_add_content("Start");
                                    ScanaStudio.dec_item_add_content("S");
                                    ScanaStudio.dec_item_add_sample_point(swd_simple.start_sample,"P")
                                    ScanaStudio.dec_item_emphasize_error();
                                    state_machine = ENUM_STATE_REQUEST;
                                    trs_io.value = -1;
                                    item_display = [];
                                    parity_array = [];
                                    ScanaStudio.dec_item_end();
                                    //Packet View
                                    ScanaStudio.packet_view_add_packet(true,ch_io,swd_simple.start_sample,swd_simple.end_sample,"SWD","CH_IO",ScanaStudio.get_channel_color(ch_io),ScanaStudio.get_channel_color(ch_io));
                                    break;
                                }
                                //Packet View
                                ScanaStudio.packet_view_add_packet(true,ch_io,swd_simple.start_sample,swd_simple.end_sample,"SWD","CH_IO",ScanaStudio.get_channel_color(ch_io),ScanaStudio.get_channel_color(ch_io));
                                var start_request = dec_item_new_v2 (ch_io, swd_simple)[0];
                                dec_item_new_v2 (ch_io, swd_simple);
                                ScanaStudio.dec_item_add_content("Start");
                                ScanaStudio.dec_item_add_content("S");
                                display_sample(swd_simple);
                                ScanaStudio.dec_item_end();
                                packet_view_add_packet_v2(ch_io,swd_simple,"Start","Request","Wrap");
                                trs_io.value = -1;
                                //Read APnDP bit
                                nbits = 1;
                                swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_io();
                                    break;
                                }
                                swd_value = Number(swd_simple.unsigned_words);
                                item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                                dec_item_new_v2(ch_io,swd_simple);
                                if (swd_value == 1)
                                {
                                    packet_string = "AP (Access Port Register)";
                                    APnDP = "AP";
                                    ScanaStudio.dec_item_add_content("APnDP : AP (Access Port Register)");
                                    ScanaStudio.dec_item_add_content("APnDP : AP");
                                    ScanaStudio.dec_item_add_content("AP");
                                }
                                else
                                {
                                    packet_string = "DP (Debug Port Register)";
                                    APnDP = "DP";
                                    ScanaStudio.dec_item_add_content("APnDP : DP (Debug Port Register)");
                                    ScanaStudio.dec_item_add_content("APnDP : DP");
                                    ScanaStudio.dec_item_add_content("DP");
                                }
                                display_sample(swd_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_io,swd_simple,"APnDP",packet_string,"Data");
                                //Read RnW bit
                                nbits = 1;
                                swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_io();
                                    break;
                                }
                                swd_value = Number(swd_simple.unsigned_words);
                                item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                                dec_item_new_v2(ch_io,swd_simple);
                                if (swd_value == 1)
                                {
                                    packet_string = "Read";
                                    RnW = "Read";
                                    ScanaStudio.dec_item_add_content("RnW : Read");
                                    ScanaStudio.dec_item_add_content("Read");
                                }
                                else
                                {
                                    packet_string = "Write";
                                    RnW = "Write";
                                    ScanaStudio.dec_item_add_content("RnW : Write");
                                    ScanaStudio.dec_item_add_content("Write");
                                }
                                display_sample(swd_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_io,swd_simple,"RnW",packet_string,"Data");
                                //Read A[2:3] bit
                                nbits = 2;
                                swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_io();
                                    break;
                                }
                                swd_value = Number(swd_simple.unsigned_words);
                                Adress = swd_value * 4;
                                get_register_name(RnW, Adress, APnDP, DP_BANK_SEL);
                                item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                                dec_item_new_v2(ch_io,swd_simple);
                                display_register_name();
                                ScanaStudio.dec_item_add_content("Adress field : 0x" + Adress);
                                ScanaStudio.dec_item_add_content("0x" + pad(Adress.toString(16),1));
                                display_sample(swd_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_io,swd_simple,"A[2:3]",packet_string,"Data");
                                //Read parity bit
                                nbits = 1;
                                swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_io();
                                    break;
                                }
                                swd_value = Number(swd_simple.unsigned_words);
                                parity_calculated = get_parity(parity_array);
                                item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                                dec_item_new_v2(ch_io,swd_simple);
                                if (swd_value == parity_calculated)
                                {
                                    packet_string = "OK";
                                    types = "Check";
                                    ScanaStudio.dec_item_add_content("Parity bit OK");
                                    ScanaStudio.dec_item_add_content("OK");
                                }
                                else
                                {
                                    packet_string = "NOT OK";
                                    types = "Error";
                                    if ((Protocol_version == SWD_PROTOCOL_VERSION_2) || DPIDR_exit_error_state == false || (Protocol_State == "Error"))
                                    // If we're in these case you instantly go Lockout State and search a line reset to go Reset State
                                    {
                                        Protocol_State = "Lockout";
                                    }
                                    else if (Protocol_State == "Transfer" || Protocol_State == "Reset")
                                    {
                                        Protocol_State = "Error";
                                    }
                                    ScanaStudio.dec_item_add_content("Parity bit NOT OK");
                                    ScanaStudio.dec_item_add_content("NOT OK");
                                    ScanaStudio.dec_item_emphasize_error();
                                }
                                display_sample_0_1(swd_simple, item_display);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_io,swd_simple,"Parity bit",packet_string,types);
                                //Read Stop bit
                                nbits = 1;
                                swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_io();
                                    break;
                                }
                                swd_value = Number(swd_simple.unsigned_words);
                                dec_item_new_v2(ch_io,swd_simple);
                                if (swd_value == 0)
                                {
                                    packet_string = "Stop";
                                    types = "Wrap";
                                    ScanaStudio.dec_item_add_content("Stop");
                                    ScanaStudio.dec_item_add_content("S");
                                }
                                else
                                {
                                    packet_string = "Stop bit value should be LOW";
                                    types = "Error";
                                    if ((Protocol_version == SWD_PROTOCOL_VERSION_2) || DPIDR_exit_error_state == false || (Protocol_State == "Error"))
                                    {
                                        Protocol_State = "Lockout";
                                    }
                                    else if (Protocol_State == "Transfer" || Protocol_State == "Reset")
                                    {
                                        Protocol_State = "Error";
                                    }
                                    ScanaStudio.dec_item_add_content("Stop");
                                    ScanaStudio.dec_item_add_content("S");
                                    ScanaStudio.dec_item_emphasize_error();
                                }
                                display_sample(swd_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_io,swd_simple,"Stop",packet_string,types);
                                //Read Park bit
                                nbits = 1;
                                swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_io();
                                    break;
                                }
                                swd_value = Number(swd_simple.unsigned_words);
                                var protocol_error_start = dec_item_new_v2(ch_io,swd_simple)[1]; // protocol_error start take the value of the sample of the end of this item
                                if (swd_value == 1)
                                {
                                    packet_string = "Park bit";
                                    types = "Wrap";
                                    ScanaStudio.dec_item_add_content("Park bit");
                                    ScanaStudio.dec_item_add_content("P");
                                }
                                else
                                {
                                    packet_string = "Park bit value should be HIGH";
                                    types = "Error";
                                    if ((Protocol_version == SWD_PROTOCOL_VERSION_2) || DPIDR_exit_error_state == false || (Protocol_State == "Error"))
                                    {
                                        Protocol_State = "Lockout";
                                    }
                                    else if (Protocol_State == "Transfer" || Protocol_State == "Reset")
                                    {
                                        Protocol_State = "Error";
                                    }
                                    ScanaStudio.dec_item_add_content("Park bit should be HIGH");
                                    ScanaStudio.dec_item_add_content("P");
                                    ScanaStudio.dec_item_emphasize_error();
                                }
                                display_sample(swd_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_io,swd_simple,"Park bit",packet_string,types);
                                var end_request = protocol_error_start;
                                // Display the driver
                                ScanaStudio.dec_item_new(ch_clk,start_request + 1,end_request - 1);
                                ScanaStudio.dec_item_add_content("Driver : Host");
                                ScanaStudio.dec_item_end();
                                while (trs_io.sample_index < swd_simple.end_sample)
                                {
                                    if (!ScanaStudio.trs_is_not_last(ch_io))
                                    {
                                        break;
                                    }
                                    trs_io = ScanaStudio.trs_get_next(ch_io);
                                }
                                if (Protocol_State == "Reset" && Register_name == "DPIDR")
                                {
                                    Protocol_State = "Transfer";
                                    state_machine = ENUM_STATE_ACK;
                                }
                                else if (Protocol_State == "Reset" && Register_name == "TARGETSEL")
                                {
                                    state_machine = ENUM_STATE_ACK;
                                }
                                else if (Protocol_State == "Reset" && Protocol_version == SWD_PROTOCOL_VERSION_2)
                                // If the SW-DP implements SWD protocol version 2, it must enter the lockout state after a single protocol error
                                // immediately after a line reset. However, if the first packet request detected by the target following line reset is valid
                                // it can then revert to entering the lockout state after an IMPLEMENTATION DEFINED number of protocol errors.
                                {
                                    Protocol_State = "Transfer";
                                    state_machine = ENUM_STATE_ACK;
                                }
                                else if (Protocol_State == "Error")
                                {
                                    state_machine = ENUM_STATE_REQUEST;
                                }
                                else if (Protocol_State == "Error" && Register_name == "DPIDR" && DPIDR_exit_error_state == true)
                                {
                                    Protocol_State = "Transfer";
                                    state_machine = ENUM_STATE_ACK;
                                }
                                else if (Protocol_State == "Lockout")
                                {
                                    state_machine = ENUM_STATE_RESET;
                                }
                                break;
                            }
                            else
                            {
                                trs_io = ScanaStudio.trs_get_next(ch_io);
                                break;
                            }
                        }
                    }//end if (Protocol_State == "Reset")
                }//end if (Transfer_State == "Reset" || Transfer_State == "Error")
                else // If we're in Transfer State
                {
                    // Check if there is a line reset
                    // trs_clk  = ScanaStudio.trs_get_before(ch_clk, swd_simple.start_sample + 1);
                    //if the error come from the ACK anyway we instantly go to ENUM_STATE_RESET
                    nbits = 50;
                    reset_sequence = sync_decode_v2(io_channel,swd_simple.start_sample + 1,nbits);
                    reset = true;
                    for (i=0; i<50; i++)
                    {
                        if(reset_sequence.signed_words[i] == 0)
                        {
                            reset = false;
                        }
                    }
                    if (reset == true)
                    {
                        ScanaStudio.dec_item_new(ch_io,reset_sequence.start_sample + 1,reset_sequence.end_sample - 1);
                        ScanaStudio.dec_item_add_content("Reset Sequence, go back to normal state");
                        ScanaStudio.dec_item_end();
                        //Packet View
                        ScanaStudio.packet_view_add_packet(true,ch_io,reset_sequence.start_sample,reset_sequence.end_sample,"RESET SEQUENCE","50 clocks with SWDIOTMS HIGH",ScanaStudio.PacketColors.Preamble.Title,ScanaStudio.PacketColors.Preamble.Content);
                        // Idle cycle
                        trs_io = ScanaStudio.trs_get_before(ch_io,reset_sequence.start_sample);
                        tmp_trs_sample_index = trs_io.sample_index;
                        while( (tmp_trs_sample_index == trs_io.sample_index) && (ScanaStudio.trs_is_not_last(ch_io) == true) )
                        {
                            trs_io = ScanaStudio.trs_get_next(ch_io);
                        }
                        var start_idle_cycles = trs_io.sample_index;
                        trs_io = ScanaStudio.trs_get_next(ch_io); // rising edge because the last one was a falling
                        ScanaStudio.dec_item_new(ch_io,start_idle_cycles + 1,trs_io.sample_index - 1);
                        ScanaStudio.dec_item_add_content("Idle Cycles");
                        ScanaStudio.dec_item_end();
                        // Display the driver on the clk line
                        ScanaStudio.dec_item_new(ch_clk,reset_sequence.start_sample + 1,trs_io.sample_index - 1);
                        ScanaStudio.dec_item_add_content("Driver : Host");
                        ScanaStudio.dec_item_end();
                        //Packet View
                        ScanaStudio.console_info_msg("test0",trs_io.sample_index);
                        ScanaStudio.packet_view_add_packet(false,ch_io,start_idle_cycles,trs_io.sample_index - 1,"RESET SEQUENCE","IDLE CYCLES",ScanaStudio.PacketColors.Misc.Title,ScanaStudio.PacketColors.Misc.Content);
                        Protocol_State = "Reset";
                        DP_BANK_SEL = 0;
                        Turnaround_period = 1;
                        swd_simple.end_sample = trs_io.sample_index;
                        swd_simple.start_sample = reset_sequence.end_sample;
                        break;
                    }

                    // If there is idles cycles after the transaction
                    nbits = 1;
                    // ScanaStudio.console_info_msg("end_sample",swd_simple.end_sample);
                    idle_cycles = sync_decode_v2(io_channel, swd_simple.end_sample + 1,nbits);
                    // ScanaStudio.console_info_msg("idle_cycles.unsigned_words : " + idle_cycles.unsigned_words,idle_cycles.end_sample);
                    if (idle_cycles.unsigned_words == 0)
                    {
                        // ScanaStudio.console_info_msg("trs_io avant avant: " + trs_io.sample_index,trs_io.sample_index);
                        trs_io = ScanaStudio.trs_get_before(ch_io,(idle_cycles.start_sample + 1)); // falling edge
                        // trs_io = ScanaStudio.trs_get_before(ch_io,(idle_cycles.start_sample + 1)); // falling edge
                        // ScanaStudio.console_info_msg("idle_cycles.start_sample + 1: " + (idle_cycles.start_sample + 1),(idle_cycles.start_sample + 1));
                        // ScanaStudio.console_info_msg("trs_io avant: " + trs_io.sample_index,trs_io.sample_index);
                        tmp_trs_sample_index = trs_io.sample_index;
                        while( (tmp_trs_sample_index == trs_io.sample_index) && (ScanaStudio.trs_is_not_last(ch_io) == true) )
                        {
                            trs_io = ScanaStudio.trs_get_next(ch_io); // rising edge
                        }
                        // ScanaStudio.console_info_msg("trs_io apres: " + trs_io.sample_index,trs_io.sample_index);
                        if (trs_io.sample_index < idle_cycles.start_sample)
                        {
                            tmp_trs_sample_index = trs_io.sample_index;
                            while( (tmp_trs_sample_index == trs_io.sample_index) && (ScanaStudio.trs_is_not_last(ch_io) == true) )
                            {
                                trs_io = ScanaStudio.trs_get_next(ch_io); // rising edge
                            }
                        }
                        // ScanaStudio.console_info_msg("trs_io apres: " + trs_io.sample_index,trs_io.sample_index);
                        trs_clk = ScanaStudio.trs_get_before(ch_clk,idle_cycles.start_sample - 1); //falling edge
                        var start_item = trs_clk.sample_index;
                        var nb_trs = 0;
                        while (trs_clk.sample_index <= trs_io.sample_index - 1)
                        {
                            tmp_trs_sample_index = trs_clk.sample_index;
                            while( (tmp_trs_sample_index == trs_clk.sample_index) && (ScanaStudio.trs_is_not_last(ch_clk) == true) )
                            {
                                trs_clk = ScanaStudio.trs_get_next(ch_clk);
                            }
                            nb_trs++;
                        }
                        if (nb_trs >= 16)
                        {
                            var test = ScanaStudio.dec_item_new(ch_io,start_item + 1,trs_io.sample_index - 1);
                            ScanaStudio.dec_item_add_content("Idles Cycles : the clock can be stopped");
                            ScanaStudio.dec_item_add_content("Idles Cycles");
                            ScanaStudio.dec_item_end();
                        }
                        else
                        {
                            var test = ScanaStudio.dec_item_new(ch_io,start_item + 1,trs_io.sample_index - 1);
                            ScanaStudio.dec_item_add_content("Idles Cycles before another packet header");
                            ScanaStudio.dec_item_add_content("Idles Cycles");
                            ScanaStudio.dec_item_end();
                        }
                        // ScanaStudio.console_info_msg("test : " + test);
                        // Display the driver
                        ScanaStudio.dec_item_new(ch_clk,start_item + 1,trs_io.sample_index - 1);
                        ScanaStudio.dec_item_add_content("Driver : Host");
                        ScanaStudio.dec_item_end();
                        // Packet view
                        ScanaStudio.packet_view_add_packet(false,ch_io,start_item + 1,trs_io.sample_index - 1,"Idles Cycles","Idles Cycles",ScanaStudio.PacketColors.Misc.Title,ScanaStudio.PacketColors.Misc.Content);
                        swd_simple.end_sample = trs_io.sample_index;
                        // Check if there is a line reset
                        trs_clk  = ScanaStudio.trs_get_before(ch_clk, trs_io.sample_index + 1);
                        nbits = 50;
                        reset_sequence = sync_decode_v2(io_channel,swd_simple.end_sample + 1,nbits);
                        reset = true;
                        for (i=0; i<50; i++)
                        {
                            if(reset_sequence.signed_words[i] == 0)
                            {
                                reset = false;
                            }
                        }
                        if (reset == true)
                        {
                            ScanaStudio.dec_item_new(ch_io,reset_sequence.start_sample + 1,reset_sequence.end_sample - 1);
                            ScanaStudio.dec_item_add_content("Reset Sequence, go back to normal state");
                            ScanaStudio.dec_item_end();
                            //Packet View
                            ScanaStudio.packet_view_add_packet(true,ch_io,reset_sequence.start_sample,reset_sequence.end_sample,"RESET SEQUENCE","50 clocks with SWDIOTMS HIGH",ScanaStudio.PacketColors.Preamble.Title,ScanaStudio.PacketColors.Preamble.Content);
                            // Idle cycle
                            trs_io = ScanaStudio.trs_get_before(ch_io,reset_sequence.start_sample);
                            tmp_trs_sample_index = trs_io.sample_index;
                            while( (tmp_trs_sample_index == trs_io.sample_index) && (ScanaStudio.trs_is_not_last(ch_io) == true) )
                            {
                                trs_io = ScanaStudio.trs_get_next(ch_io);
                            }
                            var start_idle_cycles = trs_io.sample_index;
                            trs_io = ScanaStudio.trs_get_next(ch_io); // rising edge because the last one was a falling
                            ScanaStudio.dec_item_new(ch_io,start_idle_cycles + 1,trs_io.sample_index - 1);
                            ScanaStudio.dec_item_add_content("Idle Cycles");
                            ScanaStudio.dec_item_end();
                            // Display the driver on the clk line
                            ScanaStudio.dec_item_new(ch_clk,reset_sequence.start_sample + 1,trs_io.sample_index - 1);
                            ScanaStudio.dec_item_add_content("Driver : Host");
                            ScanaStudio.dec_item_end();
                            //Packet View
                            ScanaStudio.packet_view_add_packet(false,ch_io,start_idle_cycles,trs_io.sample_index - 1,"RESET SEQUENCE","IDLE CYCLES",ScanaStudio.PacketColors.Misc.Title,ScanaStudio.PacketColors.Misc.Content);
                            Protocol_State = "Reset";
                            DP_BANK_SEL = 0;
                            Turnaround_period = 1;
                            swd_simple.end_sample = trs_io.sample_index;
                            swd_simple.start_sample = reset_sequence.end_sample;
                            break;
                        }

                        // Start bit
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,trs_io.sample_index + 1,nbits);
                    }
                    else
                    {

                        // Check if there is a line reset
                        trs_clk  = ScanaStudio.trs_get_before(ch_clk, swd_simple.start_sample + 1);
                        nbits = 50;
                        reset_sequence = sync_decode_v2(io_channel,trs_clk.sample_index + 1,nbits);
                        reset = true;
                        for (i=0; i<50; i++)
                        {
                            if(reset_sequence.signed_words[i] == 0)
                            {
                                reset = false;
                            }
                        }
                        if (reset == true)
                        {
                            ScanaStudio.dec_item_new(ch_io,reset_sequence.start_sample + 1,reset_sequence.end_sample - 1);
                            ScanaStudio.dec_item_add_content("Reset Sequence, go back to normal state");
                            ScanaStudio.dec_item_end();
                            //Packet View
                            ScanaStudio.packet_view_add_packet(true,ch_io,reset_sequence.start_sample,reset_sequence.end_sample,"RESET SEQUENCE","50 clocks with SWDIOTMS HIGH",ScanaStudio.PacketColors.Preamble.Title,ScanaStudio.PacketColors.Preamble.Content);
                            // Idle cycle
                            trs_io = ScanaStudio.trs_get_before(ch_io,reset_sequence.start_sample);
                            tmp_trs_sample_index = trs_io.sample_index;
                            while( (tmp_trs_sample_index == trs_io.sample_index) && (ScanaStudio.trs_is_not_last(ch_io) == true) )
                            {
                                trs_io = ScanaStudio.trs_get_next(ch_io);
                            }
                            var start_idle_cycles = trs_io.sample_index;
                            trs_io = ScanaStudio.trs_get_next(ch_io); // rising edge because the last one was a falling
                            ScanaStudio.dec_item_new(ch_io,start_idle_cycles + 1,trs_io.sample_index - 1);
                            ScanaStudio.dec_item_add_content("Idle Cycles");
                            ScanaStudio.dec_item_end();
                            // Display the driver on the clk line
                            ScanaStudio.dec_item_new(ch_clk,reset_sequence.start_sample + 1,trs_io.sample_index - 1);
                            ScanaStudio.dec_item_add_content("Driver : Host");
                            ScanaStudio.dec_item_end();
                            //Packet View
                            ScanaStudio.packet_view_add_packet(false,ch_io,start_idle_cycles,trs_io.sample_index - 1,"RESET SEQUENCE","IDLE CYCLES",ScanaStudio.PacketColors.Misc.Title,ScanaStudio.PacketColors.Misc.Content);
                            Protocol_State = "Reset";
                            DP_BANK_SEL = 0;
                            Turnaround_period = 1;
                            break;
                        }

                        // Start bit
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample + 1,nbits);
                    }
                    if (last_trans == true) //if sync_decode overpassed the last sample
                    {
                        go_to_last_trans_io();
                        break;
                    }
                    swd_value = Number(swd_simple.unsigned_words);
                    if (swd_value == 0)
                    {
                        dec_item_new_v2(ch_io, swd_simple);
                        ScanaStudio.dec_item_add_content("Start");
                        ScanaStudio.dec_item_add_content("S");
                        ScanaStudio.dec_item_add_sample_point(swd_simple.start_sample,"P");
                        ScanaStudio.dec_item_emphasize_error();
                        ScanaStudio.console_info_msg("start_error : " + swd_simple.end_sample,swd_simple.end_sample);
                        state_machine = ENUM_STATE_REQUEST;
                        trs_io.value = -1;
                        item_display = [];
                        parity_array = [];
                        ScanaStudio.dec_item_end();
                        //Packet View
                        ScanaStudio.packet_view_add_packet(true,ch_io,swd_simple.start_sample,swd_simple.end_sample,"SWD","CH_IO",ScanaStudio.get_channel_color(ch_io),ScanaStudio.get_channel_color(ch_io));
                        break;
                    }
                    //Packet View
                    ScanaStudio.packet_view_add_packet(true,ch_io,swd_simple.start_sample,swd_simple.end_sample,"SWD","CH_IO",ScanaStudio.get_channel_color(ch_io),ScanaStudio.get_channel_color(ch_io));
                    var start_request = dec_item_new_v2 (ch_io, swd_simple)[0];
                    ScanaStudio.dec_item_add_content("Start");
                    ScanaStudio.dec_item_add_content("S");
                    display_sample(swd_simple);
                    ScanaStudio.dec_item_end();
                    packet_view_add_packet_v2(ch_io,swd_simple,"Start","Request","Wrap");
                    trs_io.value = -1;
                    //Read APnDP bit
                    parity_array = [];
                    nbits = 1;
                    swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                    if (last_trans == true) //if sync_decode overpassed the last sample
                    {
                        go_to_last_trans_io();
                        break;
                    }
                    swd_value = Number(swd_simple.unsigned_words);
                    item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                    dec_item_new_v2(ch_io,swd_simple);
                    if (swd_value == 1)
                    {
                        packet_string = "AP (Access Port Register)";
                        APnDP = "AP";
                        ScanaStudio.dec_item_add_content("APnDP : AP (Access Port Register)");
                        ScanaStudio.dec_item_add_content("APnDP : AP");
                        ScanaStudio.dec_item_add_content("AP");
                    }
                    else
                    {
                        packet_string = "DP (Debug Port Register)";
                        APnDP = "DP";
                        ScanaStudio.dec_item_add_content("APnDP : DP (Debug Port Register)");
                        ScanaStudio.dec_item_add_content("APnDP : DP");
                        ScanaStudio.dec_item_add_content("DP");
                    }
                    display_sample(swd_simple);
                    ScanaStudio.dec_item_end();
                    //Packet View
                    packet_view_add_packet_v2(ch_io,swd_simple,"APnDP",packet_string,"Data");
                    //Read RnW bit
                    nbits = 1;
                    swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                    if (last_trans == true) //if sync_decode overpassed the last sample
                    {
                        go_to_last_trans_io();
                        break;
                    }
                    swd_value = Number(swd_simple.unsigned_words);
                    item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                    dec_item_new_v2(ch_io,swd_simple);
                    if (swd_value == 1)
                    {
                        packet_string = "Read";
                        RnW = "Read";
                        ScanaStudio.dec_item_add_content("RnW : Read");
                        ScanaStudio.dec_item_add_content("Read");
                    }
                    else
                    {
                        packet_string = "Write";
                        RnW = "Write";
                        ScanaStudio.dec_item_add_content("RnW : Write");
                        ScanaStudio.dec_item_add_content("Write");
                    }
                    display_sample(swd_simple);
                    ScanaStudio.dec_item_end();
                    //Packet View
                    packet_view_add_packet_v2(ch_io,swd_simple,"RnW",packet_string,"Data");
                    //Read A[2:3] bit
                    nbits = 2;
                    swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                    if (last_trans == true) //if sync_decode overpassed the last sample
                    {
                        go_to_last_trans_io();
                        break;
                    }
                    swd_value = Number(swd_simple.unsigned_words);
                    Adress = swd_simple.unsigned_words * 4;
                    item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                    get_register_name(RnW, Adress, APnDP, DP_BANK_SEL);
                    if (Register_name != "DPIDR" && Protocol_State == "Error")
                    {
                        Protocol_State = "Lockout";
                    }
                    dec_item_new_v2(ch_io,swd_simple);
                    display_register_name();
                    ScanaStudio.dec_item_add_content("Adress field : 0x" + Adress);
                    ScanaStudio.dec_item_add_content("0x" + pad(Adress.toString(16),1));
                    display_sample(swd_simple);
                    ScanaStudio.dec_item_end();
                    //Packet View
                    packet_view_add_packet_v2(ch_io,swd_simple,"A[2:3]",packet_string,"Data");
                    //Read parity bit
                    nbits = 1;
                    swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                    if (last_trans == true) //if sync_decode overpassed the last sample
                    {
                        go_to_last_trans_io();
                        break;
                    }
                    swd_value = Number(swd_simple.unsigned_words);
                    parity_calculated = get_parity(parity_array);
                    item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                    dec_item_new_v2(ch_io,swd_simple);
                    if (swd_value == parity_calculated)
                    {
                        packet_string = "OK";
                        types = "Check";
                        ScanaStudio.dec_item_add_content("Parity bit OK");
                        ScanaStudio.dec_item_add_content("OK");
                    }
                    else
                    {
                        packet_string = "NOT OK";
                        types = "Error";
                        if ((Protocol_version == SWD_PROTOCOL_VERSION_2) || DPIDR_exit_error_state == false || (Protocol_State == "Error"))
                        {
                            Protocol_State = "Lockout";
                        }
                        else if (Protocol_State == "Transfer" || Protocol_State == "Reset")
                        {
                            Protocol_State = "Error";
                        }
                        ScanaStudio.dec_item_add_content("Parity bit NOT OK");
                        ScanaStudio.dec_item_add_content("NOT OK");
                        ScanaStudio.dec_item_emphasize_error();
                    }
                    display_sample_0_1(swd_simple, item_display);
                    ScanaStudio.dec_item_end();
                    //Packet View
                    packet_view_add_packet_v2(ch_io,swd_simple,"Parity bit",packet_string,types);
                    //Read Stop bit
                    nbits = 1;
                    swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                    if (last_trans == true) //if sync_decode overpassed the last sample
                    {
                        go_to_last_trans_io();
                        break;
                    }
                    swd_value = Number(swd_simple.unsigned_words);
                    dec_item_new_v2(ch_io,swd_simple);
                    if (swd_value == 0)
                    {
                        packet_string = "Stop";
                        types = "Wrap";
                        ScanaStudio.dec_item_add_content("Stop");
                        ScanaStudio.dec_item_add_content("S");
                    }
                    else
                    {
                        packet_string = "Stop bit value should be LOW";
                        types = "Error";
                        if ((Protocol_version == SWD_PROTOCOL_VERSION_2) || DPIDR_exit_error_state == false || (Protocol_State == "Error"))
                        {
                            Protocol_State = "Lockout";
                        }
                        else if (Protocol_State == "Transfer" || Protocol_State == "Reset")
                        {
                            Protocol_State = "Error";
                        }
                        ScanaStudio.dec_item_add_content("Stop");
                        ScanaStudio.dec_item_add_content("S");
                        ScanaStudio.dec_item_emphasize_error();
                    }
                    display_sample(swd_simple);
                    ScanaStudio.dec_item_end();
                    //Packet View
                    packet_view_add_packet_v2(ch_io,swd_simple,"Stop",packet_string,types);
                    //Read Park bit
                    nbits = 1;
                    swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                    if (last_trans == true) //if sync_decode overpassed the last sample
                    {
                        go_to_last_trans_io();
                        break;
                    }
                    swd_value = Number(swd_simple.unsigned_words);
                    var protocol_error_start = dec_item_new_v2(ch_io,swd_simple)[1]; // protocol_error start take the value of the sample of the end of this item
                    if (swd_value == 1)
                    {
                        packet_string = "Park bit";
                        types = "Wrap";
                        ScanaStudio.dec_item_add_content("Park bit");
                        ScanaStudio.dec_item_add_content("P");
                    }
                    else
                    {
                        packet_string = "Park bit value should be HIGH";
                        types = "Error";
                        if ((Protocol_version == SWD_PROTOCOL_VERSION_2) || DPIDR_exit_error_state == false || (Protocol_State == "Error"))
                        {
                            Protocol_State = "Lockout";
                        }
                        else if (Protocol_State == "Transfer" || Protocol_State == "Reset")
                        {
                            Protocol_State = "Error";
                        }
                        ScanaStudio.dec_item_add_content("Park bit should be HIGH");
                        ScanaStudio.dec_item_add_content("P");
                        ScanaStudio.dec_item_emphasize_error();
                    }
                    display_sample(swd_simple);
                    ScanaStudio.dec_item_end();
                    //Packet View
                    var end_request = protocol_error_start; //
                    packet_view_add_packet_v2(ch_io,swd_simple,"Park bit",packet_string,types);

                    // Display the driver
                    ScanaStudio.dec_item_new(ch_clk,start_request + 1,end_request - 1);
                    ScanaStudio.dec_item_add_content("Driver : Host");
                    ScanaStudio.dec_item_end();

                    while (trs_io.sample_index < swd_simple.end_sample)
                    {
                        if (!ScanaStudio.trs_is_not_last(ch_io))
                        {
                            break;
                        }
                        trs_io = ScanaStudio.trs_get_next(ch_io);
                    }

                    if (Protocol_State == "Transfer")
                    {
                        state_machine = ENUM_STATE_ACK;
                    }
                    else if (Protocol_State == "Error")
                    {
                        state_machine = ENUM_STATE_REQUEST;
                    }
                    else if (Protocol_State == "Error" && Register_name == "DPIDR" && DPIDR_exit_error_state == true)
                    {
                        Protocol_State = "Transfer";
                        state_machine = ENUM_STATE_ACK;
                    }
                    else if (Protocol_State == "Lockout")
                    {
                        state_machine = ENUM_STATE_RESET;
                    }
                    break;
                }
            }//end ENUM_STATE_REQUEST

            case ENUM_STATE_ACK :
            {
                //Read Turnaround bits
                nbits = Turnaround_period;
                swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                if (last_trans == true) //if sync_decode overpassed the last sample
                {
                    go_to_last_trans_io();
                    break;
                }
                swd_value = Number(swd_simple.unsigned_words);
                var trs_start = ScanaStudio.trs_get_before(ch_clk,swd_simple.start_sample + 1);
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
                ScanaStudio.dec_item_new(ch_io,trs_start.sample_index,swd_simple.end_sample - 1);
                ScanaStudio.dec_item_add_content("Turnaround bits");
                ScanaStudio.dec_item_add_content("Trn");
                ScanaStudio.dec_item_end();
                //Packet View
                packet_view_add_packet_v2(ch_io,swd_simple,"Trn","Turnaround bits","Misc");
                // Display who is driving on the clk line
                ScanaStudio.dec_item_new(ch_clk,trs_start.sample_index + 1, swd_simple.end_sample - 1);
                ScanaStudio.dec_item_add_content("DRIVER : no one");
                ScanaStudio.dec_item_end();

                driver = "Target"; // The target always drive the line for the ACK
                //Read ACK
                nbits = 3;
                swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                if (last_trans == true) //if sync_decode overpassed the last sample
                {
                    go_to_last_trans_io();
                    break;
                }
                swd_value = Number(swd_simple.unsigned_words);
                var ack_item = dec_item_new_v2(ch_io,swd_simple);
                if (Register_name != "TARGETSEL") // If we use TARGETSEL we are selecting the target, so the target can't answer because it's not even targeted.
                {
                    switch (swd_value)
                    {
                        case 1 :
                        {
                            item_content = "OK Response";
                            ACK = "OK";
                            ScanaStudio.dec_item_emphasize_success();
                            state_machine = ENUM_STATE_DATA_TRANSFER;
                            break;
                        }
                        case 2 :
                        {
                            item_content = "WAIT Response";
                            ACK = "WAIT";
                            Protocol_State = "Lockout";
                            types = "Error";
                            ScanaStudio.dec_item_emphasize_warning();
                            if (ORUNDETECT == 0) // overrun disabled
                            {
                                state_machine = ENUM_STATE_RESET;
                            }
                            else // overrun enable
                            {
                                if (RnW == "Read")
                                {
                                    Register_name = "UNKNOWN DATA";
                                }
                                else
                                {
                                    Register_name = "IGNORE DATA";
                                }
                                state_machine = ENUM_STATE_DATA_TRANSFER;
                            }
                            break;
                        }
                        case 4 :
                        {
                            item_content = "FAULT Response";
                            ACK = "FAULT";
                            Protocol_State = "Lockout";
                            types = "Error";
                            ScanaStudio.dec_item_emphasize_error();
                            if (ORUNDETECT == 0) // overrun disabled
                            {
                                state_machine = ENUM_STATE_RESET;
                            }
                            else // overrun enable
                            {
                                if (RnW == "Read")
                                {
                                    Register_name = "UNKNOWN DATA";
                                }
                                else
                                {
                                    Register_name = "IGNORE DATA";
                                }
                                state_machine = ENUM_STATE_DATA_TRANSFER;
                            }
                            break;
                        }
                        case 7 :
                        {
                            item_content = "NO_ACK (no response from target)";
                            ACK = "NACK";
                            Protocol_State = "Lockout";
                            types = "Error";
                            ScanaStudio.dec_item_emphasize_error();
                            if (ORUNDETECT == 0) // overrun disabled
                            {
                                state_machine = ENUM_STATE_RESET;
                            }
                            else // overrun enable
                            {
                                if (RnW == "Read")
                                {
                                    Register_name = "UNKNOWN DATA";
                                }
                                else
                                {
                                    Register_name = "IGNORE DATA";
                                }
                                state_machine = ENUM_STATE_DATA_TRANSFER;
                            }
                            break;
                        }
                        default :
                        {
                            item_content = "Invalid ACK";
                            ACK = "INVALID ACK";
                            Protocol_State = "Lockout";
                            types = "Error";
                            ScanaStudio.dec_item_emphasize_error();
                            if (ORUNDETECT == 0) // overrun disabled
                            {
                                state_machine = ENUM_STATE_RESET;
                            }
                            else // overrun enable
                            {
                                if (RnW == "Read")
                                {
                                    Register_name = "UNKNOWN DATA";
                                }
                                else
                                {
                                    Register_name = "IGNORE DATA";
                                }
                                state_machine = ENUM_STATE_DATA_TRANSFER;
                            }
                            break;
                        }
                    }
                    ScanaStudio.dec_item_add_content("ACK : " + item_content);
                    ScanaStudio.dec_item_add_content(item_content);
                    display_sample(swd_simple);
                    ScanaStudio.dec_item_end();
                    //Packet View
                    packet_view_add_packet_v2(ch_io,swd_simple,"ACK",item_content,types);
                }
                else if (Register_name == "TARGETSEL")// it's DP TARGETSEL Register
                {
                    ScanaStudio.dec_item_add_content("Line not driven by the target because it's not selected yet");
                    ScanaStudio.dec_item_end();
                    ACK = "OK";
                    driver = "No one";
                    //Packet view
                    packet_string = "Line not driven by anyone";
                    packet_view_add_packet_v2(ch_io,swd_simple,"ACK",packet_string,"Misc");
                    state_machine = ENUM_STATE_DATA_TRANSFER;
                }
                // Display who is driven the line on the clk line
                ScanaStudio.dec_item_new(ch_clk,ack_item[0], ack_item[1]);
                ScanaStudio.dec_item_add_content("DRIVER : " + driver);
                ScanaStudio.dec_item_end();
                if (RnW == "Write" || ACK != "OK")
                {
                    //Read Turnaround bits
                    nbits = Turnaround_period + 1;
                    swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                    if (last_trans == true) //if sync_decode overpassed the last sample
                    {
                        go_to_last_trans_io();
                        break;
                    }
                    swd_value = Number(swd_simple.unsigned_words);
                    var trs_start = ScanaStudio.trs_get_before(ch_clk,swd_simple.start_sample + 1);
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
                    ScanaStudio.dec_item_new(ch_io,trs_start.sample_index,swd_simple.end_sample - 1);
                    ScanaStudio.dec_item_add_content("Turnaround bits");
                    ScanaStudio.dec_item_add_content("Trn");
                    ScanaStudio.dec_item_end();
                    // Display the driver on the clk line
                    ScanaStudio.dec_item_new(ch_clk,trs_start.sample_index + 1,swd_simple.end_sample - 1);
                    ScanaStudio.dec_item_add_content("Driver : No one");
                    ScanaStudio.dec_item_end();
                    //Packet View
                    packet_view_add_packet_v2(ch_io,swd_simple,"Trn","Turnaround bits","Misc");
                    // Display who is driven the line on the clk line
                    driver = "Host";
                }
                // Display who is driven the line on the clk line
                ScanaStudio.dec_item_new(ch_clk,trs_start.sample_index + 1, swd_simple.end_sample - 1);
                ScanaStudio.dec_item_add_content("DRIVER : no one");
                ScanaStudio.dec_item_end();
                break;
            }//end ENUM_STATE_ACK

            case ENUM_STATE_DATA_TRANSFER :
            {
                //Read data
                // Get the start data sample
                trs_clk = ScanaStudio.trs_get_before(ch_clk,swd_simple.end_sample + 1);
                if (RnW == "Write" || ACK != "OK")
                {
                    // do nothing
                }
                else
                {
                    tmp_trs_sample_index = trs_clk.sample_index;
                    while( (tmp_trs_sample_index == trs_clk.sample_index) && (ScanaStudio.trs_is_not_last(ch_clk) == true) )
                    {
                        trs_clk = ScanaStudio.trs_get_next(ch_clk);
                    }
                }
                var start_data = trs_clk.sample_index;

                // Check the behavior of the access accordly to the request and the others request
                parity_array = [];
                if (RnW == "Write") //if we do an AP/DP access write, it destroy the last AP access
                {
                    last_Register_name = "";
                }
                if (((APnDP == "AP") && (RnW == "Read")) || Register_name == "RDBUFF" || Register_name == "RESEND") // If it's an AP read access we save the name of the Register for the next access
                {
                    if (Register_name == "RESEND")
                    {
                            Register_name = last_Register_name; // RESEND can be called as many times as we want to check the value of the last AP access
                            Adress = last_Adress;
                            AP_Adress = last_AP_Adress;
                    }
                    else if (Register_name == "RDBUFF") // If we request a DPBUFF access
                    {
                        // Here we want to display the data for the last AP access BUT we also want that last_Register_name don't take because if we call RESEND we still want to display the last AP access
                        if (last_Register_name_2 == "RDBUFF") // Two request of RDBUFF in a row
                        {
                            // Do nothing, we'll read DPBUFF but with unknown data
                        }
                        else // First request of RDBUFF
                        {
                            last_Register_name_2 = Register_name; // Save the actual AP acess into a variable
                            Register_name = last_Register_name; // Replace the actual AP by the last one
                            last_Adress_2 = Adress; // Save the actual A[2:3] adress into a variable
                            Adress = last_Adress; // Replace the actual A[2:3] adress by the one used by the last access
                        }
                    }
                    else if (last_Register_name != "") // if there was any AP access before, the data will match for the last access and not this one so we invert
                    {
                        last_Register_name_2 = Register_name; // we save the actual AP acess into a variable
                        Register_name = last_Register_name; // we replace the actual AP by the last one
                        last_Register_name = last_Register_name_2; // we put the actual access into the last for the next access if there is one
                        // Same procedure with the adress
                        last_Adress_2 = Adress;
                        Adress = last_Adress;
                        last_Adress = last_Adress_2;
                        // Same procedure with the AP adress
                        last_AP_Adress_2 = AP_Adress;
                        AP_Adress = last_AP_Adress;
                        last_AP_Adress = last_AP_Adress_2;
                    }
                    else if (last_Register_name == "") //if there isn't any last Register Name then it means that, this one is the first access and so the data is UNKNOWN
                    {
                        last_Register_name = Register_name; // save the value for the next access
                        last_Adress = Adress;
                        last_AP_Adress = AP_Adress;
                        Register_name = "UNKNOWN DATA"; // The data for the first AP access is unknown
                    }
                }

                switch (Register_name) // Read the data bits accordly to the register accessed
                {
                    //DP Registers ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ //
                    case "ABORT" : // Abort Register
                    {
                        //Read DAPABORT bit
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (swd_value == 1)
                        {
                            packet_string = "Abort the current AP transaction";
                            types = "Data";
                            ScanaStudio.dec_item_add_content("DAPABORT : Abort the current AP transaction");
                            ScanaStudio.dec_item_add_content("Abort the current AP transaction");
                            ScanaStudio.dec_item_add_content("Abort transaction");
                        }
                        else
                        {
                            packet_string = "Do nothing";
                            types = "Misc";
                            ScanaStudio.dec_item_add_content("Do nothing");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"ABORT.DAPABORT",packet_string,types);
                        //Read STKCMPCLR bit
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (MINDP == "Implemented")
                        {
                            if (swd_value == 1)
                            {
                                packet_string = "Clear CTRL/STAT.STICKYCMP bit";
                                types = "Data";
                                ScanaStudio.dec_item_add_content("STKCMPCLR : Clear the CTRL/STAT.STICKYCMP bit");
                                ScanaStudio.dec_item_add_content("Clear the CTRL/STAT.STICKYCMP bit");
                                ScanaStudio.dec_item_add_content("Clear CTRL/STAT.STICKYCMP");
                            }
                            else
                            {
                                packet_string = "Do nothing";
                                types = "Misc";
                                ScanaStudio.dec_item_add_content("Do nothing");
                            }
                        }
                        else
                        {
                            packet_string = "Not implemented when MINDP is.";
                            ScanaStudio.dec_item_add_content("STKCMPCLR : Not implemented when MINDP is implemented");
                            ScanaStudio.dec_item_add_content("Not implemented when MINDP is implemented");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"ABORT.STKCMPCLR",packet_string,types);
                        //Read STKERRCLR bit
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (swd_value == 1)
                        {
                            packet_string = "Clear CTRL/STAT.STICKYERR bit";
                            types = "Data";
                            ScanaStudio.dec_item_add_content("STKERRCLR : Clear the CTRL/STAT.STICKYERR bit");
                            ScanaStudio.dec_item_add_content("Clear the CTRL/STAT.STICKYERR bit");
                            ScanaStudio.dec_item_add_content("Clear CTRL/STAT.STICKYERR");
                        }
                        else
                        {
                            packet_string = "Do nothing";
                            types = "Misc";
                            ScanaStudio.dec_item_add_content("Do nothing");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"ABORT.STKERRCLR",packet_string,types);
                        //Read WDERRCLR bit
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (swd_value == 1)
                        {
                            packet_string = "Clear CTRL/STAT.WDATAERR bit";
                            types = "Data";
                            ScanaStudio.dec_item_add_content("WDERRCLR : Clear the CTRL/STAT.WDATAERR bit");
                            ScanaStudio.dec_item_add_content("Clear the CTRL/STAT.WDATAERR bit");
                            ScanaStudio.dec_item_add_content("Clear CTRL/STAT.WDATAERR");
                        }
                        else
                        {
                            packet_string = "Do nothing";
                            types = "Misc";
                            ScanaStudio.dec_item_add_content("Do nothing");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"ABORT.WDERRCLR",packet_string,types);
                        //Read ORUNERRCLR bit
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (swd_value == 1)
                        {
                            packet_string = "Clear CTRL/STAT.STICKYORUN bit";
                            types = "Data";
                            ScanaStudio.dec_item_add_content("ORUNERRCLR : Clear the CTRL/STAT.STICKYORUN bit");
                            ScanaStudio.dec_item_add_content("Clear the CTRL/STAT.STICKYORUN bit");
                            ScanaStudio.dec_item_add_content("Clear CTRL/STAT.STICKYORUN");
                        }
                        else
                        {
                            packet_string = "Do nothing";
                            types = "Misc";
                            ScanaStudio.dec_item_add_content("Do nothing");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"ABORT.ORUNERRCLR",packet_string,types);
                        //Read Reserved, SBZ
                        nbits = 27;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (swd_value == 0)
                        {
                            types = "Misc";
                        }
                        else
                        {
                            types = "Error";
                            ScanaStudio.dec_item_emphasize_warning();
                        }
                        packet_string = "Reserved, SBZ (Should be Zero)";
                        ScanaStudio.dec_item_add_content("Reserved, SBZ (Should be Zero)");
                        ScanaStudio.dec_item_add_content("Reserved, SBZ");
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"ABORT.Reserved",packet_string,types);
                        break;
                    }//end case ABORT

                    case "DPIDR" : // Debug Port Identification Register
                    {
                        //Read RAO bit
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (swd_value == 1)
                        {
                            types = "Misc";
                        }
                        else
                        {
                            types = "Error";
                            ScanaStudio.dec_item_emphasize_warning();
                        }
                        packet_string = "RAO (Read-As-One)";
                        ScanaStudio.dec_item_add_content("Reserved, RAO (Read-As-One)");
                        ScanaStudio.dec_item_add_content("Reserved, RAO");
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"DPIDR.RAO",packet_string,types);
                        //Read DESIGNER bit (Designer of the DP)
                        nbits = 11;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        var IDR = 0;
                        var DPIDR = 0;
                        for (i=0; i<7; i++)
                        {
                            IDR += item_display[i]*Math.pow(2,i);
                        }
                        for (i=7; i<11; i++)
                        {
                            DPIDR += item_display[i]*Math.pow(2,i-7);
                        }
                        dec_item_new_v2(ch_io,swd_simple);
                        ScanaStudio.dec_item_add_content("IDR [7:1] : 0x" + pad(IDR.toString(16),2) + "  DPIDR [11:8] : 0x" + pad(DPIDR.toString(16),1));
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "IDR : 0x" + pad(IDR.toString(16),2) + ", DPIDR : 0x" + pad(DPIDR.toString(16),1);
                        packet_view_add_packet_v2(ch_io,swd_simple,"DPIDR.DESIGNER",packet_string,"Data");
                        //Read VERSION bit
                        nbits = 4;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        DP_Version = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (swd_value == 0)
                        {
                            packet_string = "Reserved, DPv0 do not implement DPIDR.";
                            types = "Error";
                            ScanaStudio.dec_item_add_content("VERSION : Reserved, DPv0 do not implement DPIDR");
                            ScanaStudio.dec_item_add_content("Reserved, DPv0 do not implement DPIDR");
                            ScanaStudio.dec_item_add_content("DPv0 do not implement DPIDR");
                            ScanaStudio.dec_item_add_content("Reserved");
                        }
                        else if (swd_value > 3)
                        {
                            packet_string = "Reserved";
                            types = "Error";
                            ScanaStudio.dec_item_add_content("Reserved");
                            ScanaStudio.dec_item_emphasize_warning();
                        }
                        else
                        {
                            packet_string = "DPv" + swd_value + " is implemented";
                            types = "Data";
                            ScanaStudio.dec_item_add_content("DPv" + swd_value + " is implemented");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"DPIDR.VERSION",packet_string,types);
                        //Read MIN bit
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (swd_value == 0)
                        {
                            packet_string = "MINDP Functions are implemented.";
                            var MINDP = "Implemented";
                            ScanaStudio.dec_item_add_content("MIN : Transaction counter, Pushed-verify, and Pushed-find operations are implemented.");
                            ScanaStudio.dec_item_add_content("Transaction counter, Pushed-verify, and Pushed-find operations are implemented.");
                            ScanaStudio.dec_item_add_content("MINDP Functions implemented");
                        }
                        else
                        {
                            packet_string = "MINDP Functions not implemented.";
                            var MINDP = "Not Implemented";
                            ScanaStudio.dec_item_add_content("MIN : Transaction counter, Pushed-verify, and Pushed-find operations are not implemented.");
                            ScanaStudio.dec_item_add_content("Transaction counter, Pushed-verify, and Pushed-find operations are not implemented.");
                            ScanaStudio.dec_item_add_content("MINDP Functions not implemented");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"DPIDR.MIN",packet_string,"Data");
                        //Read RES0 bit
                        nbits = 3;
                        RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                        //Read PARTNO
                        nbits = 8;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        ScanaStudio.dec_item_add_content("PARTNO : 0x" + pad(swd_value.toString(16),2));
                        ScanaStudio.dec_item_add_content(swd_value);
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"DPIDR.PARTNO",swd_value,"Data");
                        //Read REVISION
                        nbits = 4;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        ScanaStudio.dec_item_add_content("REVISION : 0x" + pad(swd_value.toString(16),1) + " (meaning is IMPLEMENTATION DEFINED)");
                        ScanaStudio.dec_item_add_content(swd_value);
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "0x" + pad(swd_value.toString(16),1) + " (IMPLEMENTATION DEFINED)";
                        packet_view_add_packet_v2(ch_io,swd_simple,"DPIDR.REVISION",packet_string,"Data");
                        break;
                    }//end case DPIDR

                    case "DPIDR1" : // Debug Port Identification Register 1
                    {
                        //Read ASIZE bit
                        nbits = 7;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        ScanaStudio.dec_item_add_content("ASIZE : 0x" + pad(swd_value.toString(16),2) + "-bit address");
                        ScanaStudio.dec_item_add_content("0x" + pad(swd_value.toString(16),2) + "-bit address");
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "0x" + pad(swd_value.toString(16),2) + "-bit address";
                        packet_view_add_packet_v2(ch_io,swd_simple,"DPIDR1.ASIZE",packet_string,"Data");
                        //Read ERRMODE bit
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        var IDR = 0;
                        var DPIDR = 0;
                        if (swd_value == 0)
                        {
                            packet_string = "DPIDR1.ERRMODE isn't implemented.";
                            ScanaStudio.dec_item_add_content("ERRMODE : DPIDR1.ERRMODE isn't implemented");
                            ScanaStudio.dec_item_add_content("DPIDR1.ERRMODE is not implemented");
                        }
                        else
                        {
                            packet_string = "DPIDR1.ERRMODE is implemented.";
                            ScanaStudio.dec_item_add_content("ERRMODE : DPIDR1.ERRMODE is implemented");
                            ScanaStudio.dec_item_add_content("DPIDR1.ERRMODE is implemented");
                        }
                        dec_item_new_v2(ch_io,swd_simple);
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"DPIDR1.ERRMODE",packet_string,"Data");
                        //Read RES0 bit
                        nbits = 24;
                        RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                        break;
                    }//end case DPIDR1

                    case "BASEPTR0" : // Base pointer 0
                    {
                        //Read VALID bit
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (swd_value == 0)
                        {
                            packet_string = "No valid base address is specified.";
                            ScanaStudio.dec_item_add_content("VALID : No valid base address is specified. The value of the PTR field is UNKNOWN");
                            ScanaStudio.dec_item_add_content("No valid base address is specified. The value of the PTR field is UNKNOWN");
                        }
                        else
                        {
                            packet_string = "The PTR field specifies a valid base address.";
                            ScanaStudio.dec_item_add_content("VALID : The PTR field specifies a valid base address");
                            ScanaStudio.dec_item_add_content("The PTR field specifies a valid base address");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"BASEPTR0.VALID",packet_string,"Data");
                        //Read RES0 bit
                        nbits = 11;
                        RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                        //Read PTR bit
                        nbits = 20;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        var BASEPTR0_PTR = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        ScanaStudio.dec_item_add_content("BASEPTR0_PTR : 0x" + pad(swd_value.toString(16),5));
                        ScanaStudio.dec_item_add_content("0x" + pad(swd_value.toString(16),5));
                        display_sample_0_1(swd_simple, BASEPTR0_PTR);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "0x" + pad(swd_value.toString(16),5);
                        packet_view_add_packet_v2(ch_io,swd_simple,"BASEPTR0.PTR",packet_string,"Data");
                        break;
                    }//end case BASEPTR0

                    case "BASEPTR1" : // Base pointer 1
                    {
                        //Read PTR bit
                        nbits = 32;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        var BASEPTR1_PTR = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        ScanaStudio.dec_item_add_content("BASEPTR1 [63:32] : 0x " + pad(swd_value.toString(16),8));
                        ScanaStudio.dec_item_add_content("0x " + pad(swd_value.toString(16),8));
                        display_sample_0_1(swd_simple, BASEPTR1_PTR);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "[63:32] : 0x " + pad(swd_value.toString(16),8);
                        packet_view_add_packet_v2(ch_io,swd_simple,"BASEPTR1.PTR",packet_string,"Data");
                        break;
                    }//end case BASEPTR1

                    case "CTRL/STAT" : // Control/Status register
                    {
                        //Read ORUNDETECT bit
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        ORUNDETECT = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (ORUNDETECT == 0) // disabled
                        {
                            packet_string = "Overrun detection is disabled.";
                            ScanaStudio.dec_item_add_content("ORUNDETECT : Overrun detection is disabled");
                            ScanaStudio.dec_item_add_content("Overrun detection is disabled");
                        }
                        else
                        {
                            packet_string = "Overrun detection is enabled.";
                            ScanaStudio.dec_item_add_content("ORUNDETECT : Overrun detection is enabled");
                            ScanaStudio.dec_item_add_content("Overrun detection is enabled");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"CTRL/STAT.ORUNDETECT",packet_string,"Data");
                        //Read STICKYORUN bit
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        ScanaStudio.dec_item_add_content("STICKYORUN : Access is RO/WI (Read Only/Write Ignore)");
                        ScanaStudio.dec_item_add_content("Access is RO/WI (Read Only/Write Ignore)");
                        ScanaStudio.dec_item_add_content("Access is RO/WI");
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "Access is Read Only/Write Ignore.";
                        packet_view_add_packet_v2(ch_io,swd_simple,"CTRL/STAT.STICKYORUN",packet_string,"Data");
                        //Read TRNMODE bit
                        nbits = 2;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        // item_content = " (IMPLEMENTATION DEFINED if this bit is implemented)";      IDK if it'll be usefull, i keep it atm
                        dec_item_new_v2(ch_io,swd_simple);
                        if (MINDP == "Implemented")
                        {
                            if (swd_value == 0)
                            {
                                packet_string = "Normal Operation";
                                ScanaStudio.dec_item_add_content("TRNMODE : Normal Operation");
                                ScanaStudio.dec_item_add_content("Normal Operation");
                            }
                            else if (swd_value == 1)
                            {
                                packet_string = "Pushed-verify mode";
                                ScanaStudio.dec_item_add_content("TRNMODE : Pushed-verify mode");
                                ScanaStudio.dec_item_add_content("Pushed-verify mode");
                            }
                            else if (swd_value == 2)
                            {
                                packet_string = "Pushed-compare mode";
                                ScanaStudio.dec_item_add_content("TRNMODE : Pushed-compare mode");
                                ScanaStudio.dec_item_add_content("Pushed-compare mode");
                            }
                            else
                            {
                                packet_string = "Reserved";
                                ScanaStudio.dec_item_add_content("TRNMODE : Reserved");
                                ScanaStudio.dec_item_add_content("Reserved");
                            }
                        }
                        else
                        {
                            packet_string = "Not implemented when MINDP is.";
                            ScanaStudio.dec_item_add_content("TRNMODE : Not implemented when MINDP is implemented");
                            ScanaStudio.dec_item_add_content("Not implemented when MINDP is implemented");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"CTRL/STAT.TRNMODE",packet_string,"Data");
                        //Read STICKYCMP bit
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        ScanaStudio.dec_item_add_content("STICKYCMP : Access is RO/WI (Read Only/Write Ignore)");
                        ScanaStudio.dec_item_add_content("Access is RO/WI (Read Only/Write Ignore)");
                        ScanaStudio.dec_item_add_content("Access is RO/WI");
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "Access is Read Only/Write Ignore.";
                        packet_view_add_packet_v2(ch_io,swd_simple,"CTRL/STAT.STICKYCMP",packet_string,"Data");
                        //Read STICKYERR bit
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        ScanaStudio.dec_item_add_content("STICKYERR : Access is RO/WI (Read Only/Write Ignore)");
                        ScanaStudio.dec_item_add_content("Access is RO/WI (Read Only/Write Ignore)");
                        ScanaStudio.dec_item_add_content("Access is RO/WI");
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "Access is Read Only/Write Ignore.";
                        packet_view_add_packet_v2(ch_io,swd_simple,"CTRL/STAT.STICKYERR",packet_string,"Data");
                        //Read READOK bit
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (DP_Version >= 1)
                        {
                            packet_string = "Access is Read Only/Write Ignore.";
                            ScanaStudio.dec_item_add_content("READOK : Access is RO/WI (Read Only/Write Ignore)");
                            ScanaStudio.dec_item_add_content("Access is RO/WI (Read Only/Write Ignore)");
                            ScanaStudio.dec_item_add_content("Access is RO/WI");
                        }
                        else
                        {
                            packet_string = "Isn't defined for DPv0.";
                            ScanaStudio.dec_item_add_content("READOK : Isn't defined for DPv0");
                            ScanaStudio.dec_item_add_content("Isn't defined for DPv0");
                            ScanaStudio.dec_item_add_content("Isn't Defined");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"CTRL/STAT.READOK",packet_string,"Data");
                        //Read WDATAERR bit
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        ScanaStudio.dec_item_add_content("WDATAERR : Access is RO/WI (Read Only/Write Ignore)");
                        ScanaStudio.dec_item_add_content("Access is RO/WI (Read Only/Write Ignore)");
                        ScanaStudio.dec_item_add_content("Access is RO/WI");
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "Access is Read Only/Write Ignore";
                        packet_view_add_packet_v2(ch_io,swd_simple,"CTRL/STAT.WDATAERR",packet_string,"Data");
                        //Read MASKLANE bit
                        nbits = 4;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        item_content = "";
                        for (i=0; i<4; i++)
                        {
                            if (item_display[i] == 1)
                            {
                                if (item_content = "")
                                {
                                    item_content += i;
                                }
                                else
                                {
                                    item_content += "/" + i;
                                }
                            }
                        }
                        dec_item_new_v2(ch_io,swd_simple);
                        if (MINDP == "Implemented")
                        {
                            packet_string = "Include byte lane " + item_content + " in comparisons.";
                            ScanaStudio.dec_item_add_content("MASKLANE : Include byte lane " + item_content + " in comparisons");
                            ScanaStudio.dec_item_add_content("Include byte lane " + item_content + " in comparisons");
                        }
                        else
                        {
                            packet_string = "Not Implemented when MINDP is.";
                            ScanaStudio.dec_item_add_content("MASKLANE : Not Implemented when MINDP is implemented");
                            ScanaStudio.dec_item_add_content("Not Implemented when MINDP is implemented");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"CTRL/STAT.MASKLANE",packet_string,"Data");
                        //Read TRNCNT bits
                        nbits = 12;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (MINDP == "Implemented")
                        {
                            packet_string = "Transaction Counter 0x" + pad(swd_value.toString(16),3);
                            ScanaStudio.dec_item_add_content("TRNCNT : Transaction Counter 0x" + pad(swd_value.toString(16),3));
                            ScanaStudio.dec_item_add_content("Transaction Counter 0x" + pad(swd_value.toString(16),3));
                            ScanaStudio.dec_item_add_content(swd_value);
                        }
                        else //Not Implemented
                        {
                            packet_string = "Not Implemented when MINDP is.";
                            ScanaStudio.dec_item_add_content("TRNCNT : Transaction Counter isn't implemented when MINDP is implemented");
                            ScanaStudio.dec_item_add_content("Transaction Counter isn't implemented when MINDP is implemented");
                            ScanaStudio.dec_item_add_content("Transaction Counter isn't implemented");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"CTRL/STAT.TRNCNT",packet_string,"Data");
                        //Read ERRMODE bits
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (DP_Version > 2)
                        {
                            if (swd_value == 1)
                            {
                                packet_string = "is cleared when a FAULT response is output.";
                                ScanaStudio.dec_item_add_content("ERRMODE : Errors on AP transactions set CTRL/STAT.STICKYERR, and CTRL/STAT.STICKYERR is cleared when a FAULT response is output");
                                ScanaStudio.dec_item_add_content("Errors on AP transactions set CTRL/STAT.STICKYERR, and CTRL/STAT.STICKYERR is cleared when a FAULT response is output");
                                ScanaStudio.dec_item_add_content("CTRL/STAT.STICKYERR is cleared when a FAULT response is output");
                            }
                            else
                            {
                                packet_string = "Is set until explicitly cleared.";
                                ScanaStudio.dec_item_add_content("ERRMODE : Errors on AP transactions set CTRL/STAT.STICKYERR and CTRL/STAT.STICKYERR remains set until explicitly cleared");
                                ScanaStudio.dec_item_add_content("Errors on AP transactions set CTRL/STAT.STICKYERR and CTRL/STAT.STICKYERR remains set until explicitly cleared");
                                ScanaStudio.dec_item_add_content("CTRL/STAT.STICKYERR remains set until explicitly cleared");
                            }
                        }
                        else //Not Implemented
                        {
                            if (swd_value == 1)
                            {
                                types = "Error";
                                ScanaStudio.dec_item_emphasize_error();
                            }
                            else
                            {
                                types = "Misc";
                            }
                            packet_string = "RES0 for DPv2 and before.";
                            ScanaStudio.dec_item_add_content("ERRMODE : RES0 for DPv2 and before");
                            ScanaStudio.dec_item_add_content("RES0 for DPv2 and before");
                            ScanaStudio.dec_item_add_content("RES0");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"CTRL/STAT.ERRMODE",packet_string,"Data");
                        //Read RES0 bit
                        nbits = 1;
                        RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                        //Read CDBGRSTREQ bit
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        item_content = " (IMPLEMENTATION DEFINED if this bit is implemented)";
                        if (swd_value == 0)
                        {
                            packet_string = "Do nothing.";
                            ScanaStudio.dec_item_add_content("CDBGRSTREQ : Do nothing" + item_content);
                            ScanaStudio.dec_item_add_content("Do nothing");
                        }
                        else
                        {
                            packet_string = "Initiate the debug reset request.";
                            ScanaStudio.dec_item_add_content("CDBGRSTREQ : Initiate the debug reset request" + item_content);
                            ScanaStudio.dec_item_add_content("Initiate the debug reset request");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"CDBGRSTREQ",packet_string,"Data");
                        //Read CDBGRSTACK bit
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (swd_value == 0)
                        {
                            packet_string = "Do nothing (RO).";
                            ScanaStudio.dec_item_add_content("CDBGRSTACK : Do nothing (RO bit)");
                            ScanaStudio.dec_item_add_content("Do nothing");
                        }
                        else
                        {
                            packet_string = "Accept the debug reset request.";
                            ScanaStudio.dec_item_add_content("CDBGRSTACK : Accept the debug reset request (RO bit)");
                            ScanaStudio.dec_item_add_content("Accept the debug reset request");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"CDBGRSTACK",packet_string,"Data");
                        //Read CDBGPWRUPREQ bit
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        item_content = " (IMPLEMENTATION DEFINED if this bit is implemented)";
                        if (swd_value == 0)
                        {
                            packet_string = "Do nothing.";
                            ScanaStudio.dec_item_add_content("CDBGPWRUPREQ : Do nothing");
                            ScanaStudio.dec_item_add_content("Do nothing");
                        }
                        else
                        {
                            packet_string = "Initiate the debug powerup request.";
                            ScanaStudio.dec_item_add_content("CDBGPWRUPREQ : Initiate the debug powerup request");
                            ScanaStudio.dec_item_add_content("Initiate the debug reset request");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"CDBGPWRUPREQ",packet_string,"Data");
                        //Read CDBGPWRUPACK bit
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (swd_value == 0)
                        {
                            packet_string = "Do nothing (RO).";
                            ScanaStudio.dec_item_add_content("CDBGPWRUPACK : Do nothing (RO bit)");
                            ScanaStudio.dec_item_add_content("Do nothing");
                        }
                        else
                        {
                            packet_string = "Accept the debug powerup request.";
                            ScanaStudio.dec_item_add_content("CDBGPWRUPACK : Accept the debug powerup request (RO bit)");
                            ScanaStudio.dec_item_add_content("Accept the debug reset request");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"CDBGPWRUPACK",packet_string,"Data");
                        //Read CDBGPWRUPREQ bit
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (swd_value == 0)
                        {
                            packet_string = "Do nothing.";
                            ScanaStudio.dec_item_add_content("CDBGPWRUPREQ : Do nothing");
                            ScanaStudio.dec_item_add_content("Do nothing");
                        }
                        else
                        {
                            packet_string = "Initiate System powerup request.";
                            ScanaStudio.dec_item_add_content("CDBGPWRUPREQ : Initiate the System powerup request");
                            ScanaStudio.dec_item_add_content("Initiate the debug reset request");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"CDBGPWRUPREQ",packet_string,"Data");
                        //Read CSYSPWRUPREQ bit
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (swd_value == 0)
                        {
                            packet_string = "Do nothing (RO).";
                            ScanaStudio.dec_item_add_content("CSYSPWRUPREQ : Do nothing (RO bit)");
                            ScanaStudio.dec_item_add_content("Do nothing");
                        }
                        else
                        {
                            packet_string = "Accept System powerup request.";
                            ScanaStudio.dec_item_add_content("CSYSPWRUPREQ : Accept the System powerup request (RO bit)");
                            ScanaStudio.dec_item_add_content("Accept the debug reset request");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"CSYSPWRUPREQ",packet_string,"Data");
                        break;
                    }//end case CTRL/STAT

                    case "DLCR" : // Data Link Control Register
                    {
                        //Read RES0 bit
                        nbits = 6;
                        RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                        //Read RES1 bit
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (swd_value == 1)
                        {
                            types = "Misc";
                        }
                        else
                        {
                            types = "Error";
                        }
                        ScanaStudio.dec_item_add_content("RES1");
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"DLCR.RES1","RES1",types);
                        //Read RES0 bit
                        nbits = 1;
                        RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                        //Read TURNROUND bit
                        nbits = 2;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        Turnaround_period = Number(swd_simple.unsigned_words) + 1;
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        ScanaStudio.dec_item_add_content("TURNROUND : " + Turnaround_period + " data period");
                        ScanaStudio.dec_item_add_content(Turnaround_period + " data period");
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = Turnaround_period + " data period";
                        packet_view_add_packet_v2(ch_io,swd_simple,"DLCR.TURNROUND",packet_string,"Data");
                        //Read RES0 bit
                        nbits = 22;
                        RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                        break;
                    }//end case DLCR

                    case "TARGETID" : // Target Identification register (RO register)
                    {
                        //Read SBO bit
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (swd_value == 0)
                        {
                            packet_string = "Should be 1";
                            types = "Error";
                            ScanaStudio.dec_item_add_content("SBO : Should be 1");
                            ScanaStudio.dec_item_add_content("Should be 1");
                            ScanaStudio.dec_item_emphasize_warning();
                        }
                        else
                        {
                            packet_string = "SBO bit";
                            types = "Data";
                            ScanaStudio.dec_item_add_content("SBO");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"TARGETID.SBO",packet_string,types);
                        //Read TDESIGNER bit (Designer of the part)
                        nbits = 11;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        var TARGETID_IDR = 0;
                        var TARGETIDL_DPIDR = 0;
                        for (i=0; i<7; i++)
                        {
                            TARGETID_IDR += item_display[i]*Math.pow(2,i);
                        }
                        for (i=7; i<11; i++)
                        {
                            TARGETIDL_DPIDR += item_display[i]*Math.pow(2,i-7);
                        }
                        dec_item_new_v2(ch_io,swd_simple);
                        ScanaStudio.dec_item_add_content("TARGETID [7:1] : " + pad(TARGETID_IDR.toString(16),2) + " TARGETID [11:8] : " + pad(TARGETIDL_DPIDR.toString(16),1));
                        ScanaStudio.dec_item_add_content("[7:1] : " + pad(TARGETID_IDR.toString(16),2) + " [11:8] : " +  pad(TARGETIDL_DPIDR.toString(16),1));
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "[7:1] : " + pad(TARGETID_IDR.toString(16),2) + "[11:8] : " + pad(TARGETIDL_DPIDR.toString(16),1);
                        packet_view_add_packet_v2(ch_io,swd_simple,"TARGETID.TDESIGNER",packet_string,"Data");
                        //Read TPARTNO
                        nbits = 16;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        ScanaStudio.dec_item_add_content("TPARTNO : 0x" + pad(swd_value.toString(16),4));
                        ScanaStudio.dec_item_add_content(swd_value);
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"TARGETID.TPARTNO",swd_value,types);
                        //Read TREVISION
                        nbits = 4;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        ScanaStudio.dec_item_add_content("TREVISION : 0x" + pad(swd_value.toString(16),1) + " (meaning is IMPLEMENTATION DEFINED)");
                        ScanaStudio.dec_item_add_content("TREVISION : 0x" + pad(swd_value.toString(16),1));
                        ScanaStudio.dec_item_add_content(swd_value);
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string ="0x" + pad(swd_value.toString(16),1) + " (meaning is IMPLEMENTATION DEFINED)";
                        packet_view_add_packet_v2(ch_io,swd_simple,"TARGETID.TREVISION",packet_string,"Data");
                        break;
                    }//end case "TARGETID"

                    case "DLPIDR" : // Data Link Protocol Identification Register
                    {
                        //Read PROTVSN bit
                        nbits = 4;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (swd_value == 1)
                        {
                            packet_string = "SWD protocol Version 2";
                            types = "Data";
                            Protocol_version = SWD_PROTOCOL_VERSION_2;
                            ScanaStudio.dec_item_add_content("PROTVSN : SWD protocol Version 2");
                        }
                        else
                        {
                            packet_string = "Reserved Version"
                            types = "Data";
                            ScanaStudio.dec_item_add_content("Reserved");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"DLPIDR.PROTVSN",packet_string,types);
                        //Read RES0 bit
                        nbits = 24;
                        RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                        //Read TINSTANCE bit
                        nbits = 4;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        ScanaStudio.dec_item_add_content("TINSTANCE : Instance Number 0x" + pad(swd_value.toString(16),1) + "(this value must be unique for devices with identical TARGETID_TPARTNO and TARGETID_TDESIGNER)");
                        ScanaStudio.dec_item_add_content("Instance Number 0x" + pad(swd_value.toString(16),1));
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "Instance Number 0x" + pad(swd_value.toString(16),1);
                        packet_view_add_packet_v2(ch_io,swd_simple,"DLPIDR.TINSTANCE",packet_string,"Data");
                        break;
                    }//end case DLPIDR

                    case "EVENTSTAT" : // Event Status register
                    {
                        //Read EA bit
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (swd_value == 0)
                        {
                            packet_string = "An event requires attention";
                            ScanaStudio.dec_item_add_content("EA : An event requires attention");
                            ScanaStudio.dec_item_add_content("An event requires attention");
                        }
                        else
                        {
                            packet_string = "There is no event requiring attention"
                            ScanaStudio.dec_item_add_content("EA : There is no event requiring attention");
                            ScanaStudio.dec_item_add_content("There is no event requiring attention");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"EVENTSTAT.EA",packet_string,"Data");
                        //Read RES0 bit
                        nbits = 31;
                        RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                        break;
                    }//end case EVENTSTAT

                    case "SELECT1" : // AP Select registers
                    {
                        //Read ADDR
                        nbits = 32;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        SELECT1_ADDR = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        ScanaStudio.dec_item_add_content("ADDR : [31:63] 0x" + pad(SELECT1_ADDR.toString(16),8));
                        ScanaStudio.dec_item_add_content("[31:63] 0x" + pad(SELECT1_ADDR.toString(16),8));
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "[31:63] 0x" + pad(SELECT1_ADDR.toString(16),8);
                        packet_view_add_packet_v2(ch_io,swd_simple,"SELECT1.ADDR",packet_string,"Data");
                        update_AP_adress();
                        break;
                    }//end case SELECT1

                    case "SELECT" : // AP Select registers
                    {
                        //Read DPBANKSEL
                        nbits = 4;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        DP_BANK_SEL = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        ScanaStudio.dec_item_add_content("DPBANKSEL : 0x" + pad(DP_BANK_SEL.toString(16),1));
                        ScanaStudio.dec_item_add_content("0x" + pad(DP_BANK_SEL.toString(16),1));
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "0x" + pad(DP_BANK_SEL.toString(16),1);
                        packet_view_add_packet_v2(ch_io,swd_simple,"SELECT.DPBANKSEL",packet_string,"Data");
                        //Read ADRESS
                        nbits = 28;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        SELECT_ADDR = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        ScanaStudio.dec_item_add_content("ADDR : 0x" + pad(SELECT_ADDR.toString(16),7));
                        ScanaStudio.dec_item_add_content("[4:31] [" + item_display + "]");
                        display_sample_0_1(swd_simple, item_display);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "[4:31] 0x" + pad(SELECT_ADDR.toString(16),7);
                        packet_view_add_packet_v2(ch_io,swd_simple,"SELECT.ADRESS",packet_string,"Data");
                        update_AP_adress();
                        break;
                    }//end case SELECT

                    case "RDBUFF" : // Read Buffer register
                    {
                        //Read DATA LINK DEFINED (On an SW-DP, the Read Buffer presents data that was captured during the previous AP read, enabling repeatedly returning the value without generating a new AP access)
                        // What's below doesn't describe this because the selection of the right AP is done before, so we use this case to say that you're calling RDBUFF two times in a row or without ap access before and the result is unknown
                        nbits = 32;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        packet_string = "UNKNOWN DATA : 0x" + pad(swd_value.toString(16),8);
                        ScanaStudio.dec_item_add_content("UNKNOWN DATA : 0x" + pad(swd_value.toString(16),8));
                        display_sample_0_1(swd_simple, item_display);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"RDBUFF.DATA",packet_string,"Data");
                        break;
                    }//end case RDBUFF

                    case "RESEND" : // Read Resend register
                    {
                        //DATA LINK DEFINED Performing a read to the RESEND register does not capture new data from the AP, but returns the value that was returned by the last AP read or DP RDBUFF read.
                        nbits = 32;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        packet_string = "There wasn't any AP read before";
                        ScanaStudio.dec_item_add_content("There wasn't any AP read before");
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"RESEND.DATA",packet_string,"Data");
                        break;
                    }//end case RESEND

                    case "TARGETSEL" : // Target Selection register (WO register)
                    {
                        if (last_Protocol_State == "Reset")
                        {
                            //Read SBO bit
                            nbits = 1;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            swd_value = Number(swd_simple.unsigned_words);
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            dec_item_new_v2(ch_io,swd_simple);
                            if (swd_value == 0)
                            {
                                packet_string = "Should be 1";
                                types = "Error";
                                ScanaStudio.dec_item_add_content("SBO : Should be 1");
                                ScanaStudio.dec_item_add_content("Should be 1");
                                ScanaStudio.dec_item_emphasize_warning();
                            }
                            else
                            {
                                packet_string = "SBO bit";
                                types = "Data";
                                ScanaStudio.dec_item_add_content("SBO");
                            }
                            display_sample(swd_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_io,swd_simple,"TARGETSEL.SBO",packet_string,types);
                            //Read TDESIGNER bit (Designer of the part)
                            nbits = 11;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            swd_value = Number(swd_simple.unsigned_words);
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            var TARGETSEL_IDR = 0;
                            var TARGETSEL_DPIDR = 0;
                            for (i=0; i<7; i++)
                            {
                                TARGETSEL_IDR += item_display[i]*Math.pow(2,i);
                            }
                            for (i=7; i<11; i++)
                            {
                                TARGETSEL_DPIDR += item_display[i]*Math.pow(2,i-7);
                            }
                            dec_item_new_v2(ch_io,swd_simple);
                            ScanaStudio.dec_item_add_content("TARGETSEL_IDR [7:1] : 0x" + pad(TARGETSEL_IDR.toString(16),2) + " TARGETSEL_DPIDR [11:8] : 0x" + pad(TARGETSEL_DPIDR.toString(16),1));
                            ScanaStudio.dec_item_add_content("[7:1] : 0x" + pad(TARGETSEL_IDR.toString(16),2) + " [11:8] : 0x" + pad(TARGETSEL_DPIDR.toString(16),1));
                            display_sample(swd_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_string = "[7:1] : 0x" + pad(TARGETSEL_IDR.toString(16),2) + " [11:8] : 0x" + pad(TARGETSEL_DPIDR.toString(16),1);
                            packet_view_add_packet_v2(ch_io,swd_simple,"TARGETSEL.TDESIGNER",packet_string,"Data");
                            //Read TPARTNO
                            nbits = 16;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            swd_value = Number(swd_simple.unsigned_words);
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            dec_item_new_v2(ch_io,swd_simple);
                            ScanaStudio.dec_item_add_content("TPARTNO : 0x" + pad(swd_value.toString(16),4));
                            ScanaStudio.dec_item_add_content(swd_value);
                            display_sample(swd_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_io,swd_simple,"TARGETSEL.TPARTNO",swd_value,types);
                            //Read TINSTANCE
                            nbits = 4;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            swd_value = Number(swd_simple.unsigned_words);
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            dec_item_new_v2(ch_io,swd_simple);
                            ScanaStudio.dec_item_add_content("TINSTANCE : 0x" + pad(swd_value.toString(16),1) + " (this value must be unique for devices with identical TARGETID_TPARTNO and TARGETID_TDESIGNER)");
                            ScanaStudio.dec_item_add_content("TINSTANCE : 0x" + pad(swd_value.toString(16),1));
                            ScanaStudio.dec_item_add_content(swd_value);
                            display_sample(swd_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_string = "0x" + pad(swd_value.toString(16),1) + " (IMPLEMENTATION DEFINED)";
                            packet_view_add_packet_v2(ch_io,swd_simple,"TARGETSEL.TINSTANCE",packet_string,"Data");
                        }//end if last_Protocol_State == "Reset" (if TARGETSEL instantly follow a reset line)
                        else // if TARGETSEL don't follow a reset line
                        {
                            //Read UNPREDICTABLE
                            nbits = 32;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            swd_value = Number(swd_simple.unsigned_words);
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            dec_item_new_v2(ch_io,swd_simple);
                            ScanaStudio.dec_item_add_content("Write to TARGETSEL is UNPREDICTABLE if it doesn't follow a line reset");
                            ScanaStudio.dec_item_add_content("UNPREDICTABLE");
                            display_sample(swd_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_io,swd_simple,"TARGETSEL","UNPREDICTABLE","Misc");
                        }
                        break;
                    }//end case "TARGETSEL"

                    case "Reserved, RES0" : // Wrong combination of A[2:3] and DPBANKSEL who refer to an RES0 Register
                    {
                        //Read RES0 bit
                        nbits = 32;
                        RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                        break;
                    }//end case"Reserved, RES0"

                    case "RO Register" : // Request a Write on a RO register (i don't know what happend but atm for the demo that's work)
                    {
                        //Read RES0 bit
                        nbits = 32;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        ScanaStudio.dec_item_add_content("This is an RO Register");
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"RO_REGISTER.ERROR","It's an RO Register",types);
                        break;
                    }//end case RO Register

                    // AP Registers ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ //
                    case "DAR" : //Direct Access registers
                    {
                        if (DARSIZE == 10)
                        {
                            //Read accessed data bits
                            nbits = 32;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            swd_value = Number(swd_simple.unsigned_words);
                            var DAR_nb = AP_Adress + Adress/4;
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            dec_item_new_v2(ch_io,swd_simple);
                            ScanaStudio.dec_item_add_content("DAR" + DAR_nb + " : Accessed data 0x" + pad(swd_value.toString(16),8));
                            display_sample(swd_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_string = "Accessed data 0x" + pad(swd_value.toString(16),8);
                            packet_view_add_packet_v2(ch_io,swd_simple,"DAR.DATA",packet_string,"Data");
                            break;
                        }
                        else
                        {
                            //Read accessed data bits
                            nbits = 32;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            swd_value = Number(swd_simple.unsigned_words);
                            var DAR_nb = AP_Adress + Adress/4;
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            dec_item_new_v2(ch_io,swd_simple);
                            ScanaStudio.dec_item_add_content("DAR Registers aren't implemented, 0x" + pad(swd_value.toString(16),8));
                            display_sample_0_1(swd_simple,item_display);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_string = "Accessed data 0x" + pad(swd_value.toString(16),8);
                            packet_view_add_packet_v2(ch_io,swd_simple,"DAR.DATA",packet_string,"Data");
                            break;
                        }
                    }//end case DAR

                    case "CSW" : //Control/Status Word register
                    {
                        if (AP_Memory == "MEM-AP")
                        {
                            //Read size
                            nbits = 3;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            swd_value = Number(swd_simple.unsigned_words);
                            var data_size = Math.pow(2,swd_value + 4);
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            dec_item_new_v2(ch_io,swd_simple);
                            packet_string = "Data Type " + data_size + "-bits";
                            types = "Data";
                            if ((swd_value < 2)  && (Bytes_lanes_implemented == true))
                            {
                                ScanaStudio.dec_item_add_content("SIZE : Data Type " + data_size + "-bits");
                                ScanaStudio.dec_item_add_content("Data Type " + data_size + "-bits");
                            }
                            else if (swd_value == 2)
                            {
                                ScanaStudio.dec_item_add_content("SIZE : Data Type " + data_size + "-bits");
                                ScanaStudio.dec_item_add_content("Data Type " + data_size + "-bits");
                            }
                            else if (swd_value > 2 && Large_data_extension_implemented == true)
                            {
                                ScanaStudio.dec_item_add_content("SIZE : Data Type " + data_size + "-bits");
                                ScanaStudio.dec_item_add_content("Data Type " + data_size + "-bits");
                            }
                            else
                            {
                                packet_string = "Data Type Reserved or Not Implemented";
                                types = "Error";
                                ScanaStudio.dec_item_add_content("SIZE : Data Type Reserved or Not Implemented");
                                ScanaStudio.dec_item_add_content("Data Type Reserved");
                                ScanaStudio.dec_item_emphasize_warning();
                            }
                            display_sample(swd_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_io,swd_simple,"CSW.SIZE",packet_string,types);
                            //Read RES0 bit
                            nbits = 1;
                            RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                            //Read AddrInc bits
                            nbits = 2;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            AddrInc = Number(swd_simple.unsigned_words);
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            dec_item_new_v2(ch_io,swd_simple);
                            types = "Data";
                            switch (AddrInc)
                            {
                                case 0 :

                                {
                                    packet_string = "Auto-increment off";
                                    ScanaStudio.dec_item_add_content("AddrInc : Auto-increment off"); //The address in the TAR is not automatically incremented, and remains unchanged after any Data Read/Write Register access.
                                    break;
                                }
                                case 1 :
                                {
                                    packet_string = "Increment single";
                                    ScanaStudio.dec_item_add_content("AddrInc : Increment single"); //After a successful DRW access, the address in the TAR is incremented by the size of the access
                                    break;
                                }
                                case 2 :
                                {
                                    if (Packet_transfers_implemented == true)
                                    {
                                        packet_string = "Increment packed";
                                        ScanaStudio.dec_item_add_content("AddrInc : Increment packed"); // Increment packed, enables packed transfers, which pack multiple halfword or byte memory accesses into a single word AP access
                                        break;
                                    }
                                    else
                                    {
                                        packet_string = "Incorrect value, packet transfers isn't implemented";
                                        ScanaStudio.dec_item_add_content("AddrInc : Incorrect value, packet transfers isn't implemented");
                                        break;
                                    }
                                }
                                default :
                                {
                                    packet_string = "Reserved";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("AddrInc : Reserved");
                                    break;
                                }
                            }
                            display_sample(swd_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_io,swd_simple,"CSW.AddrInc",packet_string,types);
                            //Read DeviceEn
                            nbits = 1;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            swd_value = Number(swd_simple.unsigned_words);
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            dec_item_new_v2(ch_io,swd_simple);
                            if (swd_value == 0)
                            {
                                packet_string = "The MEM-AP is not enabled";
                                ScanaStudio.dec_item_add_content("DeviceEn : The MEM-AP is not enabled");
                                ScanaStudio.dec_item_add_content("The MEM-AP is not enabled");
                            }
                            else
                            {
                                packet_string = "Transactions can be issued through the MEM-AP";
                                ScanaStudio.dec_item_add_content("DeviceEn : Transactions can be issued through the MEM-AP");
                                ScanaStudio.dec_item_add_content("Transactions can be issued through the MEM-AP");
                            }
                            display_sample(swd_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_io,swd_simple,"CSW.DeviceEn",packet_string,"Data");
                            //Read TrInProg
                            nbits = 1;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            swd_value = Number(swd_simple.unsigned_words);
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            dec_item_new_v2(ch_io,swd_simple);
                            if (swd_value == 0)
                            {
                                packet_string = "The connection to the memory system is idle";
                                ScanaStudio.dec_item_add_content("TrInProg : The connection to the memory system is idle");
                                ScanaStudio.dec_item_add_content("The connection to the memory system is idle");
                            }
                            else
                            {
                                packet_string = "A transfer is in progress on the connection to the memory system";
                                ScanaStudio.dec_item_add_content("TrInProg : A transfer is in progress on the connection to the memory system");
                                ScanaStudio.dec_item_add_content("A transfer is in progress on the connection to the memory system");
                            }
                            display_sample(swd_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_io,swd_simple,"CSW.TrInProg",packet_string,"Data");
                            //Read Mode
                            nbits = 4;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            swd_value = Number(swd_simple.unsigned_words);
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            dec_item_new_v2(ch_io,swd_simple);
                            // IMPLEMENTATION DEFINED
                            if (swd_value == 0)
                            {
                                packet_string = "Basic mode";
                                ScanaStudio.dec_item_add_content("Mode : Basic mode");
                                ScanaStudio.dec_item_add_content("Basic mode");
                            }
                            else if (swd_value == 1 && Barrier_operation_extension_implemented)
                            {
                                packet_string = "Barrier support enabled";
                                ScanaStudio.dec_item_add_content("Mode : Barrier support enabled");
                                ScanaStudio.dec_item_add_content("Barrier support enabled");
                            }
                            else
                            {
                                packet_string = "Reserved";
                                ScanaStudio.dec_item_add_content("Mode : Reserved");
                                ScanaStudio.dec_item_add_content("Reserved");
                            }
                            display_sample(swd_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_io,swd_simple,"CSW.Mode",packet_string,"Data");
                            //Read Type
                            nbits = 4;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            swd_value = Number(swd_simple.unsigned_words);
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            dec_item_new_v2(ch_io,swd_simple);
                            // IMPLEMENTATION DEFINED
                            ScanaStudio.dec_item_add_content("Type : IMPLEMENTATION DEFINED")
                            display_sample_0_1(swd_simple, item_display);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_io,swd_simple,"CSW.Type",packet_string,"Data");
                            //Read ERRNPASS
                            nbits = 1;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            swd_value = Number(swd_simple.unsigned_words);
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            dec_item_new_v2(ch_io,swd_simple);
                            if (CSW_ERRNPASS_implemented == true)
                            {
                                if (swd_value == 0)
                                {
                                    packet_string = "Errors are passed upstream";
                                    ScanaStudio.dec_item_add_content("ERRNPASS : Errors are passed upstream");
                                    ScanaStudio.dec_item_add_content("Errors are passed upstream");
                                }
                                else
                                {
                                    packet_string = "Errors are not passed upstream";
                                    ScanaStudio.dec_item_add_content("ERRNPASS : Errors are not passed upstream");
                                    ScanaStudio.dec_item_add_content("Errors are not passed upstream");
                                }
                            }
                            else
                            {
                                packet_string = "ERRNPASS isn't implemented";
                                ScanaStudio.dec_item_add_content("ERRNPASS : ERRNPASS isn't implemented");
                                ScanaStudio.dec_item_add_content("ERRNPASS isn't implemented");
                            }
                            display_sample(swd_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_io,swd_simple,"CSW.ERRNPASS",packet_string,"Data");
                            //Read ERRSTOP
                            nbits = 1;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            swd_value = Number(swd_simple.unsigned_words);
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            dec_item_new_v2(ch_io,swd_simple);
                            if (CSW_ERRSTOP_implemented == true)
                            {
                                if (swd_value == 0)
                                {
                                    packet_string = "Memory access errors do not prevent future memory accesses";
                                    ScanaStudio.dec_item_add_content("ERRSTOP : Memory access errors do not prevent future memory accesses");
                                    ScanaStudio.dec_item_add_content("Memory access errors do not prevent future memory accesses");
                                }
                                else
                                {
                                    packet_string = "Memory access errors prevent future memory accesses";
                                    ScanaStudio.dec_item_add_content("ERRSTOP : Memory access errors prevent future memory accesses");
                                    ScanaStudio.dec_item_add_content("Memory access errors prevent future memory accesses");
                                }
                            }
                            else
                            {
                                packet_string = "ERRSTOP isn't implemented";
                                ScanaStudio.dec_item_add_content("ERRSTOP : ERRSTOP isn't implemented");
                                ScanaStudio.dec_item_add_content("ERRSTOP isn't implemented");
                            }

                            display_sample(swd_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_io,swd_simple,"CSW.ERRSTOP",packet_string,"Data");
                            //Read RES0 bit
                            nbits = 5;
                            RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                            //Read SDeviceEn
                            nbits = 1;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            var SDeviceEn = Number(swd_simple.unsigned_words);
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            dec_item_new_v2(ch_io,swd_simple);
                            if (SDeviceEn == 0)
                            {
                                packet_string = "Secure access is disabled";
                                ScanaStudio.dec_item_add_content("SDeviceEn : Secure access is disabled");
                                ScanaStudio.dec_item_add_content("Secure access is disabled");
                            }
                            else
                            {
                                packet_string = "Secure access is enabled";
                                ScanaStudio.dec_item_add_content("SDeviceEn : Secure access is enabled");
                                ScanaStudio.dec_item_add_content("Secure access is enabled");
                            }
                            display_sample(swd_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_io,swd_simple,"CSW.SDeviceEn",packet_string,"Data");
                            //Read Prot
                            nbits = 7;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            swd_value = Number(swd_simple.unsigned_words);
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            dec_item_new_v2(ch_io,swd_simple);
                            // IMPLEMENTATION DEFINED (if not implemented RES0)
                            ScanaStudio.dec_item_add_content("Prot : 0x" + pad(swd_value.toString(16),2) + " , IMPLEMENTATION DEFINED");
                            display_sample_0_1(swd_simple, item_display);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_io,swd_simple,"CSW.Prot",packet_string,"Data");
                            //Read DbgSwEnable
                            nbits = 1;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            swd_value = Number(swd_simple.unsigned_words);
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            dec_item_new_v2(ch_io,swd_simple);
                            if (swd_value == 0)
                            {
                                packet_string = "Debug software access is disabled";
                                ScanaStudio.dec_item_add_content("DbgSwEnable : Debug software access is disabled. If DeviceEn is 0b0, DbgSwEnable must be ignored and treated as one");
                                ScanaStudio.dec_item_add_content("Debug software access is disabled. If DeviceEn is 0b0, DbgSwEnable must be ignored and treated as one");
                            }
                            else
                            {
                                packet_string = "Debug software access is enabled";
                                ScanaStudio.dec_item_add_content("DbgSwEnable : Debug software access is enabled");
                                ScanaStudio.dec_item_add_content("Debug software access is enabled");
                            }
                            display_sample(swd_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_io,swd_simple,"CSW.DbgSwEnable",packet_string,"Data");
                            break;
                        }
                        else if (AP_Memory == "JTAG-AP")
                        {
                            //Read SRST_OUT
                            nbits = 1;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            swd_value = Number(swd_simple.unsigned_words);
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            dec_item_new_v2(ch_io,swd_simple);
                            if (swd_value == 0)
                            {
                                packet_string = "Deassert nSRSTOUT HIGH";
                                ScanaStudio.dec_item_add_content("SRST_OUT : Deassert nSRSTOUT HIGH");
                                ScanaStudio.dec_item_add_content("Deassert nSRSTOUT HIGH");
                            }
                            else
                            {
                                packet_string = "Assert nSRSTOUT LOW";
                                ScanaStudio.dec_item_add_content("SRST_OUT : Assert nSRSTOUT LOW");
                                ScanaStudio.dec_item_add_content("Assert nSRSTOUT LOW");
                            }
                            display_sample(swd_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_io,swd_simple,"CSW.SRST_OUT",packet_string,"Data");
                            //Read TRST_OUT
                            nbits = 1;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            swd_value = Number(swd_simple.unsigned_words);
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            dec_item_new_v2(ch_io,swd_simple);
                            if (swd_value == 0)
                            {
                                packet_string = "Deassert TRST HIGH";
                                ScanaStudio.dec_item_add_content("TRST_OUT : Deassert TRST HIGH");
                                ScanaStudio.dec_item_add_content("Deassert TRST HIGH");
                            }
                            else
                            {
                                packet_string = "Assert TRST LOW";
                                ScanaStudio.dec_item_add_content("TRST_OUT : Assert TRST LOW");
                                ScanaStudio.dec_item_add_content("Assert TRST LOW");
                            }
                            display_sample(swd_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_io,swd_simple,"CSW.TRST_OUT",packet_string,"Data");
                            //Read SRSTCONNECTED
                            nbits = 1;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            swd_value = Number(swd_simple.unsigned_words);
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            dec_item_new_v2(ch_io,swd_simple);
                            ScanaStudio.dec_item_add_content("SRSTCONNECTED : 0x" + pad(swd_value.toString(16),1) + ", logical AND of the SRSTCONNECTED signals from all ports that are currently selected (RO field)");
                            ScanaStudio.dec_item_add_content("0x" + pad(swd_value.toString(16),1) + ", logical AND of the SRSTCONNECTED signals from all ports that are currently selected (RO field)");
                            display_sample(swd_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_string = "0x" + pad(swd_value.toString(16),1) + " (RO field)";
                            packet_view_add_packet_v2(ch_io,swd_simple,"CSW.SRSTCONNECTED",packet_string,"Data");
                            //Read PORTCONNECTED
                            nbits = 1;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            swd_value = Number(swd_simple.unsigned_words);
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            dec_item_new_v2(ch_io,swd_simple);
                            ScanaStudio.dec_item_add_content("PORTCONNECTED : 0x" + pad(swd_value.toString(16),1) + ", logical AND of the PORTCONNECTED signals from all ports that are currently selected (RO field)");
                            ScanaStudio.dec_item_add_content("0x" + pad(swd_value.toString(16),1) + ", logical AND of the PORTCONNECTED signals from all ports that are currently selected (RO field)");
                            display_sample(swd_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_string = "0x" + pad(swd_value.toString(16),1) + " (RO field)";
                            packet_view_add_packet_v2(ch_io,swd_simple,"CSW.PORTCONNECTED",packet_string,"Data");
                            //Read RES0 bit
                            nbits = 20;
                            RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                            //Read RFIFOCNT
                            nbits = 3;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            swd_value = Number(swd_simple.unsigned_words);
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            dec_item_new_v2(ch_io,swd_simple);
                            ScanaStudio.dec_item_add_content("RFIFOCNT : 0x" + pad(swd_value.toString(16),1) + ",  number of bytes of response data available in the Response FIFO (RO field)");
                            ScanaStudio.dec_item_add_content("0x" + pad(swd_value.toString(16),1) + ",  number of bytes of response data available in the Response FIFO (RO field)");
                            ScanaStudio.dec_item_add_content("0x" + pad(swd_value.toString(16),1) + ",  number of bytes of response data available in the Response FIFO");
                            display_sample(swd_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_string = "0x" + pad(swd_value.toString(16),1) + " (RO field)";
                            packet_view_add_packet_v2(ch_io,swd_simple,"CSW.RFIFOCNT",packet_string,"Data");
                            //Read RES0 bit
                            nbits = 1;
                            RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                            //Read WFIFOCNT
                            nbits = 3;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            WFIFOCNT = Number(swd_simple.unsigned_words);
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            dec_item_new_v2(ch_io,swd_simple);
                            ScanaStudio.dec_item_add_content("WFIFOCNT : 0x" + pad(swd_value.toString(16),1) + ",  number of command bytes held in the Command FIFO that have yet to be processed by the JTAG Engine (RO field)");
                            ScanaStudio.dec_item_add_content("0x" + pad(swd_value.toString(16),1) + ",  number of command bytes held in the Command FIFO that have yet to be processed by the JTAG Engine (RO field)");
                            ScanaStudio.dec_item_add_content("0x" + pad(swd_value.toString(16),1) + ",  number of command bytes held in the Command FIFO that have yet to be processed ");
                            display_sample(swd_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_string = "0x" + pad(swd_value.toString(16),1) + " (RO field)";
                            packet_view_add_packet_v2(ch_io,swd_simple,"CSW.WFIFOCNT",packet_string,"Data");
                            //Read SERACTV
                            nbits = 1;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            SERACTV = Number(swd_simple.unsigned_words);
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            dec_item_new_v2(ch_io,swd_simple);
                            if (swd_value == 0)
                            {
                                packet_string = "JTAG Engine is inactive";
                                ScanaStudio.dec_item_add_content("SERACTV : JTAG Engine is inactive, provided WFIFOCNT is also 0b0.");
                                ScanaStudio.dec_item_add_content("JTAG Engine is inactive, provided WFIFOCNT is also 0b0.");
                            }
                            else
                            {
                                packet_string = "JTAG Engine is processing commands";
                                ScanaStudio.dec_item_add_content("SERACTV : JTAG Engine is processing commands from the Command FIFO");
                                ScanaStudio.dec_item_add_content("JTAG Engine is processing commands from the Command FIFO");
                            }
                            display_sample(swd_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_io,swd_simple,"CSW.SERACTV",packet_string,"Data");
                        }
                    }//end case CSW

                    case "TAR" : //Transfer Address Register
                    {
                        //Read Adress TAR (0x4)[0:31] or TAR (0x8)[32:63] (if Large Physical Adress Extension is implemented)
                        nbits = 32;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (Adress == 4)
                        {
                            TAR_Adress_LSB = Number(swd_simple.unsigned_words);
                            fill_TAR_Adress();
                            packet_string = "[31:0] : 0x" + pad(TAR_Adress_LSB.toString(16),8);
                            ScanaStudio.dec_item_add_content("Address [31:0] : 0x" + pad(TAR_Adress_LSB.toString(16),8) + ", TAR_Adress [63:32] : " + TAR_string_hexa);
                            ScanaStudio.dec_item_add_content("0x" + pad(TAR_Adress_LSB.toString(16),8));
                        }
                        else if ((Adress == 8) && (Large_physical_adress_extension_implemented == true))
                        {
                            TAR_Adress_MSB = Number(swd_simple.unsigned_words);
                            fill_TAR_Adress();
                            packet_string = "[63:32] : 0x" + pad(TAR_Adress_MSB.toString(16),8);
                            ScanaStudio.dec_item_add_content("Address [63:32] : 0x" + pad(TAR_Adress_MSB.toString(16),8) + ", TAR_Adress [63:32] : " + TAR_string_hexa);
                            ScanaStudio.dec_item_add_content("0x" + pad(TAR_Adress_MSB.toString(16),8));
                        }
                        else
                        {
                            // TAR_Adress_MSB = Number(swd_simple.unsigned_words);
                            packet_string = "RES 0 : Large Data Adress isn't Implemented";
                            ScanaStudio.dec_item_add_content("Address [63:32] : RES0 : Large Data Adress isn't Implemented");
                            ScanaStudio.dec_item_add_content("RES0 : Large Data Adress isn't Implemented");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"TAR.Address",packet_string,"Data");
                        break;
                    }//end case TAR

                    case "DRW" : // Data Read/Write register
                    {
                        //Read or Write the data to the TAR Address / initiates a write/read to the address specified by the TAR
                        nbits = 32;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (RnW == "Write")
                        {
                            packet_string = "Write to TAR_Adress : 0x"  + pad(swd_value.toString(16),8);
                            if (AddrInc == 1 || AddrInc == 2)
                            {
                                ScanaStudio.dec_item_add_content("Write to TAR_Adress, Data 0x"  + pad(swd_value.toString(16),8) + "(don't forget that AutoInc is enable)");
                                ScanaStudio.dec_item_add_content("Data : 0x" + pad(swd_value.toString(16),8));
                            }
                            else
                            {
                                ScanaStudio.dec_item_add_content("Write to TAR_Adress, Data 0x"  + pad(swd_value.toString(16),8));
                                ScanaStudio.dec_item_add_content("Data : 0x" + pad(swd_value.toString(16),8));
                            }
                        }
                        else if (RnW == "Read")
                        {
                            packet_string = "Read from TAR_Adress : 0x" + pad(swd_value.toString(16),8);
                            if (AddrInc == 1 || AddrInc == 2)
                            {
                                ScanaStudio.dec_item_add_content("Read from TAR_Adress, Data 0x" + pad(swd_value.toString(16),8) + "(don't forget that AutoInc is enable)");
                                ScanaStudio.dec_item_add_content("Data : 0x" + pad(swd_value.toString(16),8));
                            }
                            else
                            {
                                ScanaStudio.dec_item_add_content("Read from TAR_Adress, Data 0x" + pad(swd_value.toString(16),8));
                                ScanaStudio.dec_item_add_content("Data : 0x" + pad(swd_value.toString(16),8));
                            }

                        }
                        display_sample_0_1(swd_simple, item_display);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"DRW.Data",packet_string,"Data");
                        break;
                    }//end case DRW

                    case "BD" : // Banked Data Register
                    {
                        // Provide direct read or write access to a block of four wordsof memory, starting at the address that is specified in the TAR
                        nbits = 32;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (RnW == "Write")
                        {
                            packet_string = "BD" + (Adress/4) + " Write : 0x" + pad(swd_value.toString(16),8);
                            ScanaStudio.dec_item_add_content("BD" + (Adress/4) + " Write : 0x" + pad(swd_value.toString(16),8));
                        }
                        else if (RnW == "Read")
                        {
                            packet_string = "BD" + (Adress/4) + " Read : 0x" + pad(swd_value.toString(16),8);
                            ScanaStudio.dec_item_add_content("BD" + (Adress/4) + " Read : 0x" + pad(swd_value.toString(16),8));
                        }
                        display_sample_0_1(swd_simple, item_display);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"BD.Data",packet_string,"Data");
                        break;
                    }//end case DRW

                    case "MBT" : // Memory Barrier Transfer register
                    {
                        // The MBT register generates a barrier operation on the bus.
                        nbits = 32;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (Barrier_operation_extension_implemented == true)
                        {
                            packet_string = "IMPLEMENTATION DEFINED";
                            types = "Data";
                            ScanaStudio.dec_item_add_content("MBT : IMPLEMENTATION DEFINED");
                        }
                        else
                        {
                            packet_string = "This register isn't implemented";
                            types = "Misc";
                            ScanaStudio.dec_item_add_content("MBT : This register isn't implemented if Barrier Operation Extension isn't");
                            ScanaStudio.dec_item_add_content("MBT : This register isn't implemented");
                        }
                        display_sample_0_1(swd_simple, item_display);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"MBT.Data",packet_string,types);
                        break;
                    }//end case MBT

                    case "TRR" : //Transfer Response register
                    {
                        if (TRR_implemented == true)
                        {
                            // ERR bit
                            nbits = 1;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            swd_value = Number(swd_simple.unsigned_words);
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            dec_item_new_v2(ch_io,swd_simple);
                            if (RnW == "Read")
                            {
                                if (swd_value == 0)
                                {
                                    packet_string = "No error response was logged";
                                    ScanaStudio.dec_item_add_content("ERR : No error response was logged");
                                    ScanaStudio.dec_item_add_content("No error response was logged");
                                }
                                else
                                {
                                    packet_string = "An error response was logged";
                                    ScanaStudio.dec_item_add_content("ERR : An error response was logged");
                                    ScanaStudio.dec_item_add_content("An error response was logged");
                                }
                            }
                            else
                            {
                                if (swd_value == 0)
                                {
                                    packet_string = "No effect";
                                    ScanaStudio.dec_item_add_content("ERR : No effect");
                                    ScanaStudio.dec_item_add_content("No effect");
                                }
                                else
                                {
                                    packet_string = "This field is cleared to 0b0";
                                    ScanaStudio.dec_item_add_content("ERR : This field is cleared to 0b0");
                                    ScanaStudio.dec_item_add_content("This field is cleared to 0b0");
                                }
                            }
                            display_sample_0_1(swd_simple, item_display);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_io,swd_simple,"TRR.ERR",packet_string,"Data");
                            //Read RES0 bit
                            nbits = 31;
                            RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                        }
                        else
                        {
                            // TRR is not implemented
                            nbits = 32;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            swd_value = Number(swd_simple.unsigned_words);
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            dec_item_new_v2(ch_io,swd_simple);
                            ScanaStudio.dec_item_add_content("TRR is not implemented (look CFG.ERR)");
                            display_sample(swd_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_io,swd_simple,"TRR","Not Implemented","Misc");
                        }
                        break;
                    }//end case TRR

                    case "BASE" : //Debug Base Address register
                    {
                        if (Adress == 0)
                        {
                            if (Large_physical_adress_extension_implemented == true) // If BASEADDR = 64
                            {
                                //Read BASEADDR [63:32]
                                nbits = 32;
                                swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_io();
                                    break;
                                }
                                BASEADDR_MSW = Number(swd_simple.unsigned_words);
                                item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                                dec_item_new_v2(ch_io,swd_simple);
                                ScanaStudio.dec_item_add_content("BASEADDR : [63:32] : 0x" + pad(BASEADDR_MSW.toString(16),8));
                                display_sample(swd_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = "[63:32] : 0x" + pad(BASEADDR_MSW.toString(16),8);
                                packet_view_add_packet_v2(ch_io,swd_simple,"BASE.BASEADDR",packet_string,"Data");
                            }
                            else // If BASEADDR = 32 bits
                            {
                                //Read RES0 bit
                                nbits = 32;
                                swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_io();
                                    break;
                                }
                                swd_value = Number(swd_simple.unsigned_words);
                                item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                                dec_item_new_v2(ch_io,swd_simple);
                                if (swd_value == 0)
                                {
                                    types = "Misc";
                                }
                                else
                                {
                                    types = "Error";
                                }
                                ScanaStudio.dec_item_add_content("RES0, because BASEADDR is 32 bits");
                                display_sample(swd_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_io,swd_simple,"BASE.BASEADDR","[63:32] are RES0",types);
                            }
                        }
                        else // Adress 0x8
                        {
                            // P bit
                            nbits = 1;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            swd_value = Number(swd_simple.unsigned_words);
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            dec_item_new_v2(ch_io,swd_simple);
                            if (swd_value == 0)
                            {
                                packet_string = "No debug entry is present";
                                ScanaStudio.dec_item_add_content("P : No debug entry is present");
                                ScanaStudio.dec_item_add_content("No debug entry is present");
                            }
                            else
                            {
                                packet_string = "Debug entry is present";
                                ScanaStudio.dec_item_add_content("P : Debug entry is present");
                                ScanaStudio.dec_item_add_content("Debug entry is present");
                            }
                            display_sample_0_1(swd_simple, item_display);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_io,swd_simple,"BASE.P",packet_string,"Data");
                            //Read Format bit
                            nbits = 1;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            swd_value = Number(swd_simple.unsigned_words);
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            dec_item_new_v2(ch_io,swd_simple);
                            if (swd_value == 1)
                            {
                                packet_string = "ADIv6 format";
                                types = "Data";
                                ScanaStudio.dec_item_add_content("ADIv6 format");
                            }
                            else
                            {
                                packet_string = "Error in ADIv format";
                                ScanaStudio.dec_item_add_content("Error in ADIv format");
                                types = "Error";
                            }
                            display_sample(swd_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_io,swd_simple,"BASE.RES0",packet_string,types);
                            //Read RES0 bit
                            nbits = 10;
                            RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                            //Read BASEADDR [31:12]
                            nbits = 20;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            BASEADDR_LSW = Number(swd_simple.unsigned_words);
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            dec_item_new_v2(ch_io,swd_simple);
                            ScanaStudio.dec_item_add_content("BASEADDR : [31:12] : 0x" + pad(BASEADDR_LSW.toString(16),5));
                            display_sample(swd_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_string = "[31:12] : 0x" + pad(BASEADDR_LSW.toString(16),8);
                            packet_view_add_packet_v2(ch_io,swd_simple,"BASE.BASEADDR",packet_string,"Data");
                        }
                        break;
                    }//end case BASE

                    case "CFG" : // Configuration register
                    {
                        // BE bit (Big-Endian)
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        swd_value = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (swd_value == 0)
                        {
                            packet_string = "RAZ bit";
                            ScanaStudio.dec_item_add_content("BE : RAZ bit");
                            ScanaStudio.dec_item_add_content("RAZ bit");
                        }

                        else
                        {
                            packet_string = "RAZ : Should be 0";
                            ScanaStudio.dec_item_add_content("BE : RAZ : Should be 0");
                            ScanaStudio.dec_item_add_content("RAZ : Should be 0");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"CFG.BE",packet_string,"Data");
                        // LA bit (Long Adress)
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        swd_value = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (swd_value == 1)
                        {
                            Large_physical_adress_extension_implemented = true;
                            packet_string = "Large physical adress extension implemented";
                            ScanaStudio.dec_item_add_content("LA : The implementation supports physical addresses with more than 32 bits");
                            ScanaStudio.dec_item_add_content("The implementation supports physical addresses with more than 32 bits");
                        }

                        else
                        {
                            Large_physical_adress_extension_implemented = false;
                            packet_string = "Large physical adress extension not implemented ";
                            ScanaStudio.dec_item_add_content("LA : The implementation support only physical addresses of 32 bits or smaller");
                            ScanaStudio.dec_item_add_content("The implementation support only physical addresses of 32 bits or smaller");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"CFG.LA",packet_string,"Data");
                        // LD bit (Large Data)
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        swd_value = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (swd_value == 1)
                        {
                            Large_data_extension_implemented = true;
                            packet_string = "Large Data extension Implemented";
                            ScanaStudio.dec_item_add_content("LD : The implementation includes the Large Data Extension, and supports data items larger than 32 bits");
                            ScanaStudio.dec_item_add_content("The implementation includes the Large Data Extension, and supports data items larger than 32 bits");
                        }

                        else
                        {
                            Large_data_extension_implemented = false;
                            packet_string = "Large Data extension not Implemented ";
                            ScanaStudio.dec_item_add_content("LD : The implementation does not support data items that are larger than 32 bits");
                            ScanaStudio.dec_item_add_content("The implementation does not support data items that are larger than 32 bits");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"CFG.LD",packet_string,"Data");
                        //Read RES0 bit
                        nbits = 1;
                        RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                        // DARSIZE bit
                        nbits = 4;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        DARSIZE = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        types = "Data";
                        if (DARSIZE == 0)
                        {
                            packet_string = "DAR0-DAR255 are not implemented";
                            ScanaStudio.dec_item_add_content("DARSIZE : DAR0-DAR255 are not implemented");
                            ScanaStudio.dec_item_add_content("DAR0-DAR255 are not implemented");
                        }
                        else if (DARSIZE == 10)
                        {
                            packet_string = "DAR0-DAR255 are implemented";
                            ScanaStudio.dec_item_add_content("DARSIZE : DAR0-DAR255, which occupy a register space of 1KB, are implemented");
                            ScanaStudio.dec_item_add_content("DAR0-DAR255, which occupy a register space of 1KB, are implemented");
                        }
                        else
                        {
                            packet_string = "Reserved";
                            types = "Error";
                            ScanaStudio.dec_item_add_content("DARSIZE : Reserved");
                            ScanaStudio.dec_item_add_content("Reserved");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"CFG.DARSIZE",packet_string,"Data");
                        // ERR bit
                        nbits = 4;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        swd_value = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        types = "Data";
                        if (swd_value == 0)
                        {
                            CSW_ERRNPASS_implemented = false;
                            CSW_ERRSTOP_implemented = false;
                            TRR_implemented = false;
                            packet_string = "TRR/CSW.ERRNPASS/CSW.ERRSTOP not implemented";
                            ScanaStudio.dec_item_add_content("ERR : Error response are always passed upstream. TRR/CSW.ERRNPASS/CSW.ERRSTOP not implemented");
                            ScanaStudio.dec_item_add_content("Error response are always passed upstream. TRR/CSW.ERRNPASS/CSW.ERRSTOP not implemented");
                        }
                        else if (swd_value == 1)
                        {
                            CSW_ERRNPASS_implemented = true;
                            CSW_ERRSTOP_implemented = true;
                            TRR_implemented = true;
                            packet_string = "TRR/CSW.ERRNPASS/CSW.ERRSTOP implemented";
                            ScanaStudio.dec_item_add_content("ERR : TRR/CSW.ERRNPASS/CSW.ERRSTOP implemented");
                            ScanaStudio.dec_item_add_content("TRR/CSW.ERRNPASS/CSW.ERRSTOP implemented");
                        }
                        else
                        {
                            packet_string = "Reserved";
                            types = "Error";
                            ScanaStudio.dec_item_add_content("ERR : Reserved");
                            ScanaStudio.dec_item_add_content("Reserved");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"CFG.ERR",packet_string,"Data");
                        //Read RES0 bit
                        nbits = 4;
                        RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                        // TARINC bit
                        nbits = 4;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        swd_value = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        types = "Data";
                        if (swd_value == 0)
                        {
                            packet_string = "The TAR incrementer size is not specified.";
                            ScanaStudio.dec_item_add_content("TARINC : The TAR incrementer size is not specified, at least 10bits");
                            ScanaStudio.dec_item_add_content("The TAR incrementer size is not specified, at least 10bits");
                        }
                        else
                        {
                            packet_string = (9+swd_value) + " bits";
                            ScanaStudio.dec_item_add_content("TARINC : " + (9+swd_value) + " bits");
                            ScanaStudio.dec_item_add_content((9+swd_value) + " bits");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"CFG.TARINC",packet_string,"Data");
                        //Read RES0 bit
                        nbits = 12;
                        RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                        break;
                    }//end case CFG

                    case "IDR" : // Identification register
                    {
                        // TYPE bit
                        nbits = 4;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        IDR_TYPE = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        types = "Data";
                        switch (IDR_TYPE)
                        {
                            case 0 : //0x0
                            {
                                packet_string = "JTAG connection";
                                ScanaStudio.dec_item_add_content("TYPE : JTAG connection"); // VARIANT field must be non-zero
                                ScanaStudio.dec_item_add_content("JTAG connection");
                                break;
                            }
                            case 1 : //0x1
                            {
                                packet_string = "AMBA AHB3 bus";
                                ScanaStudio.dec_item_add_content("TYPE : AMBA AHB3 bus");
                                ScanaStudio.dec_item_add_content("AMBA AHB3 bus");
                                break;
                            }
                            case 2 : //0x2
                            {
                                packet_string = "AMBA APB2 or APB3 bus";
                                ScanaStudio.dec_item_add_content("TYPE : AMBA APB2 or APB3 bus");
                                ScanaStudio.dec_item_add_content("AMBA APB2 or APB3 bus");
                                break;
                            }
                            case 4 : //0x4
                            {
                                packet_string = "AMBA AXI3 or AXI4 bus";
                                ScanaStudio.dec_item_add_content("TYPE : AMBA AXI3 or AXI4 bus, with optional ACE-Lite support");
                                ScanaStudio.dec_item_add_content("AMBA AXI3 or AXI4 bus, with optional ACE-Lite support");
                                break;
                            }
                            case 5 : //0x5
                            {
                                packet_string = "AMBA AHB5 bus";
                                ScanaStudio.dec_item_add_content("TYPE : AMBA AHB5 bus");
                                ScanaStudio.dec_item_add_content("AMBA AHB5 bus");
                                break;
                            }
                            default : // Others
                            {
                                packet_string = "Reserved";
                                types = "Error";
                                ScanaStudio.dec_item_add_content("TYPE : Reserved");
                                ScanaStudio.dec_item_add_content("Reserved");
                                break;
                            }
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"IDR.TYPE",packet_string,types);
                        // VARIANT bit
                        nbits = 4;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        swd_value = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (IDR_TYPE == 0 && swd_value == 0) //JTAG connection
                        {
                            packet_string = "Must not be 0";
                            types = "Error";
                            ScanaStudio.dec_item_add_content("VARIANT : must not be 0");
                            ScanaStudio.dec_item_add_content("must not be 0");
                        }
                        else
                        {
                            packet_string = "0x" + pad(swd_value.toString(16),1);
                            types = "Data";
                            ScanaStudio.dec_item_add_content("VARIANT : 0x" + pad(swd_value.toString(16),1));
                            ScanaStudio.dec_item_add_content("0x" + pad(swd_value.toString(16),1));
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"IDR.VARIANT",packet_string,types);
                        //Read RES0 bit
                        nbits = 5;
                        RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                        // CLASS bit
                        nbits = 4;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        CLASS = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (IDR_TYPE == 0)
                        {
                            if (CLASS == 0)
                            {
                                packet_string = "No defined class";
                                ScanaStudio.dec_item_add_content("CLASS : No defined class");
                                ScanaStudio.dec_item_add_content("No defined class");
                            }
                            else
                            {
                                packet_string = "When TYPE=0, CLASS must be 0 too";
                                ScanaStudio.dec_item_add_content("CLASS : When TYPE=0, CLASS must be 0 too");
                                ScanaStudio.dec_item_add_content("When TYPE=0, CLASS must be 0 too");
                            }
                        }
                        else if (CLASS == 8)
                        {
                            packet_string = "Memory Access Port";
                            ScanaStudio.dec_item_add_content("CLASS : Memory Access Port");
                            ScanaStudio.dec_item_add_content("Memory Access Port");
                        }
                        else
                        {
                            packet_string = "Invalid class value";
                            ScanaStudio.dec_item_add_content("CLASS : Invalid class value");
                            ScanaStudio.dec_item_add_content("Invalid class value");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"IDR.CLASS",packet_string,"Data");
                        //Read DESIGNER bit
                        nbits = 11;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        swd_value = Number(swd_simple.unsigned_words);
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        var IDR_IDR = 0;
                        var IDR_DPIDR = 0;
                        for (i=0; i<7; i++)
                        {
                            IDR_IDR += item_display[i]*Math.pow(2,i);
                        }
                        for (i=7; i<11; i++)
                        {
                            IDR_DPIDR += item_display[i]*Math.pow(2,i-7);
                        }
                        dec_item_new_v2(ch_io,swd_simple);
                        ScanaStudio.dec_item_add_content("IDR [23:17] : 0x" + pad(IDR_IDR.toString(16),2) + "IDR [27:24] : 0x" + pad(IDR_DPIDR.toString(16),1));
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_string = "[23:17] : 0x" + pad(IDR_IDR.toString(16),2) + "[27:24] : 0x" + pad(IDR_DPIDR.toString(16),1);
                        packet_view_add_packet_v2(ch_io,swd_simple,"IDR.DESIGNER",packet_string,"Data");
                        // REVISION bit
                        nbits = 4;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        swd_value = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (swd_value == 0)
                        {
                            packet_string = "First implementation of an AP design";
                            ScanaStudio.dec_item_add_content("REVISION : First implementation of an AP design");
                            ScanaStudio.dec_item_add_content("First implementation of an AP design");
                        }
                        else
                        {
                            packet_string = "This AP design had 0x" + pad(swd_value.toString(16),1) + " revisions";
                            ScanaStudio.dec_item_add_content("REVISION : This AP design had 0x" + pad(swd_value.toString(16),1) + " Major/Minor revisions");
                            ScanaStudio.dec_item_add_content("This AP design had 0x" + pad(swd_value.toString(16),1) + " Major/Minor revisions");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"IDR.REVISION",packet_string,"Data");
                        break;
                    }//end case IDR

                    case "ITCTRL" : // Integration Mode Control Register
                    {
                        // IME bit
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        IDR_TYPE = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (swd_value == 0)
                        {
                            packet_string = "The component must enter functional mode";
                            ScanaStudio.dec_item_add_content("IME : The component must enter functional mode");
                            ScanaStudio.dec_item_add_content("The component must enter functional mode");
                        }
                        else
                        {
                            packet_string = "The component must enter integration mode";
                            ScanaStudio.dec_item_add_content("IME : The component must enter integration mode, and enable support for topology detection and integration testing");
                            ScanaStudio.dec_item_add_content("The component must enter integration mode, and enable support for topology detection and integration testing");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"ITCTRL.IME",packet_string,types);
                        //Read RES0 bit
                        nbits = 31;
                        RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                        break;
                    }//end case ITCTRL

                    case "CLAIMCLR" : // Claim Tag Clear Register
                    case "CLAIMSET" : // Claim Tag Set Register
                    {
                        // Claim tag 0 bit
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        IDR_TYPE = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (swd_value == 0)
                        {
                            packet_string = "Claim tag 0 is not set";
                            ScanaStudio.dec_item_add_content("CLAIM_TAG_0 : Claim tag 0 is not set");
                            ScanaStudio.dec_item_add_content("Claim tag 0 is not set");
                        }
                        else
                        {
                            packet_string = "Claim tag 0 is set";
                            ScanaStudio.dec_item_add_content("CLAIM_TAG_0 : Claim tag 0 is set");
                            ScanaStudio.dec_item_add_content("Claim tag 0 is set");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        Title = Register_name + ".TAG_0";
                        packet_view_add_packet_v2(ch_io,swd_simple,Title,packet_string,"Data");
                        // Claim tag 0 bit
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        IDR_TYPE = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (swd_value == 0)
                        {
                            packet_string = " Claim tag 1 is not set";
                            ScanaStudio.dec_item_add_content("CLAIM_TAG_1 : Claim tag 0 is not set");
                            ScanaStudio.dec_item_add_content("Claim tag 1 is not set");
                        }
                        else
                        {
                            packet_string = " Claim tag 1 is set";
                            ScanaStudio.dec_item_add_content("CLAIM_TAG_1 : Claim tag 0 is set");
                            ScanaStudio.dec_item_add_content("Claim tag 1 is set");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        Title = Register_name + ".TAG_1";
                        packet_view_add_packet_v2(ch_io,swd_simple,Title,packet_string,"Data");
                        //IMPLEMENTATION DEFINED bits
                        nbits = 30;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        swd_value = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        ScanaStudio.dec_item_add_content("IMPLEMENTATION_DEFINED : 0x" + pad(swd_value.toString(16),8));
                        display_sample_0_1(swd_simple, item_display);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        Title = Register_name + ".IMPLEMENTATION_DEFINED";
                        packet_view_add_packet_v2(ch_io,swd_simple,Title," IMPLEMENTATION_DEFINED","Data");
                        break;
                    }//end case CLAIMCLR/CLAIMSET

                    case "DEVAFF" : // Device Affinity Registers
                    {
                        nbits = 32;
                        RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                        break;
                    }//end case DEVAFF

                    case "LAR" : // Lock Access Register
                    {
                        // KEY bits
                        nbits = 32;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        swd_value = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        ScanaStudio.dec_item_add_content("KEY : WI (Write is ignored)");
                        display_sample_0_1(swd_simple, item_display);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"LAR.KEY","WI (Write is ignored)","Data");
                        break;
                    }//end case LAR

                    case "LSR" : // Lock Status Register
                    {
                        // SLI bits
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        swd_value = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        ScanaStudio.dec_item_add_content("SLI : RAZ (Read as zero)");
                        display_sample_0_1(swd_simple, item_display);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"LSR.SLI","RAZ (Read as zero)","Data");
                        // SLK bits
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        swd_value = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        ScanaStudio.dec_item_add_content("SLK : RAZ (Read as zero)");
                        display_sample_0_1(swd_simple, item_display);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"LSR.SLK","RAZ (Read as zero)","Data");
                        // nTT bits
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        swd_value = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        ScanaStudio.dec_item_add_content("nTT : RAZ (Read as zero)");
                        display_sample_0_1(swd_simple, item_display);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"LSR.nTT","RAZ (Read as zero)","Data");
                        //RES0
                        nbits = 29;
                        RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                        break;
                    }//end case LSR

                    case "AUTHSTATUS" : // Authentication Status Register
                    {
                        // NSID bits
                        nbits = 2;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        swd_value = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        types = "Data";
                        if (AP_Memory == "MEM-AP" || AP_Memory == "JTAG-AP")
                        {
                            if (swd_value == 0)
                            {
                                packet_string = "Isn't supported";
                                ScanaStudio.dec_item_add_content("NSID : Non-secure invasive debug isn't supported");
                                ScanaStudio.dec_item_add_content("Non-secure invasive debug isn't supported");
                                ScanaStudio.dec_item_add_content("NSID : Isn't supported");
                            }
                            else
                            {
                                packet_string = "For " + AP_Memory + " it should be 0";
                                ScanaStudio.dec_item_add_content("NSID : For " + AP_Memory + " this field should be 0");
                                ScanaStudio.dec_item_add_content("For " + AP_Memory + " this field should be 0");
                            }
                        }
                        else // Other AP than MEM/JTAG-AP
                        {
                            if (swd_value == 0)
                            {
                                packet_string = "Isn't supported";
                                ScanaStudio.dec_item_add_content("NSID : Non-secure invasive Debug is supported");
                                ScanaStudio.dec_item_add_content("Non-secure invasive Debug Support is supported");
                                ScanaStudio.dec_item_add_content("NSID : Is supported");
                            }
                            else
                            {
                                packet_string = "Is supported";
                                ScanaStudio.dec_item_add_content("NSID : Non-secure invasive Debug is supported");
                                ScanaStudio.dec_item_add_content("Non-secure invasive Debug Support is supported");
                                ScanaStudio.dec_item_add_content("NSID : Is supported");
                            }
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"AUTHSTATUS.NSID",packet_string,types);
                        // NSNID bits
                        nbits = 2;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        swd_value = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        types = "Data";
                        if (AP_Memory == "MEM-AP")
                        {
                            if (swd_value == 0)
                            {
                                packet_string = "Isn't supported";
                                ScanaStudio.dec_item_add_content("NSNID : Non-secure noninvasive debug isn't supported");
                                ScanaStudio.dec_item_add_content("Non-secure noninvasive debug isn't supported");
                                ScanaStudio.dec_item_add_content("NSNID : Isn't supported");
                            }
                            else
                            {
                                packet_string = "For MEM-AP it should be 0";
                                ScanaStudio.dec_item_add_content("NSNID : For MEM-AP this field should be 0");
                                ScanaStudio.dec_item_add_content("For MEM-AP this field should be 0");
                            }
                        }
                        else if (AP_Memory == "JTAG-AP")
                        {
                            if (SDeviceEn == 0)
                            {
                                if (swd_value == 2)
                                {
                                    packet_string = "Is supported";
                                    ScanaStudio.dec_item_add_content("NSNID : Non-secure noninvasive debug is supported");
                                    ScanaStudio.dec_item_add_content("Non-secure noninvasive debug is supported");
                                    ScanaStudio.dec_item_add_content("NSNID : Is supported");
                                }
                                else
                                {
                                    packet_string = "For JTAG-AP it should be 2";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("NSNID : For JTAG-AP this field should be 2");
                                    ScanaStudio.dec_item_add_content("For JTAG-AP this field should be 2");
                                }
                            }
                            else if (SDeviceEn == 1)
                            {
                                if (swd_value == 2)
                                {
                                    packet_string = "Is supported";
                                    ScanaStudio.dec_item_add_content("NSNID : Non-secure noninvasive debug is supported and (NIDEN | DBGEN) == true");
                                    ScanaStudio.dec_item_add_content("Non-secure noninvasive debug is supported");
                                    ScanaStudio.dec_item_add_content("NSNID : Is supported");
                                }
                                else
                                {
                                    packet_string = "For JTAG-AP it should be 3";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("NSNID : For JTAG-AP this field should be 3");
                                    ScanaStudio.dec_item_add_content("For JTAG-AP this field should be 3");
                                }
                            }
                        }
                        else // Other AP than MEM/JTAG-AP
                        {
                            if (swd_value == 0)
                            {
                                packet_string = "Isn't supported";
                                ScanaStudio.dec_item_add_content("NSNID : Non-secure noninvasive Debug Support isn't supported");
                                ScanaStudio.dec_item_add_content("Non-secure noninvasive Debug Support isn't supported");
                                ScanaStudio.dec_item_add_content("NSNID :  Isn't supported");
                            }
                            else
                            {
                                packet_string = "Is supported";
                                ScanaStudio.dec_item_add_content("NSNID : Non-secure noninvasive Debug is supported");
                                ScanaStudio.dec_item_add_content("Non-secure noninvasive Debug is supported");
                                ScanaStudio.dec_item_add_content("NSNID : Is supported");
                            }
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"AUTHSTATUS.NSNID",packet_string,types);
                        // SID bits
                        nbits = 2;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        swd_value = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        types = "Data";
                        if (AP_Memory == "MEM-AP" || AP_Memory == "JTAG-AP")
                        {
                            if (swd_value == 0)
                            {
                                packet_string = "Isn't supported";
                                ScanaStudio.dec_item_add_content("SID : Secure invasive isn't supported");
                                ScanaStudio.dec_item_add_content("Secure invasive isn't supported");
                                ScanaStudio.dec_item_add_content("SID : Isn't supported");
                            }
                            else
                            {
                                packet_string = "For MEM-AP it should be 0";
                                ScanaStudio.dec_item_add_content("SID : For " + AP_Memory + " this field should be 0");
                                ScanaStudio.dec_item_add_content("For MEM-AP this field should be 0");
                            }
                        }
                        else // Other AP than MEM/JTAG-AP
                        {
                            if (swd_value == 0)
                            {
                                packet_string = "Isn't supported";
                                ScanaStudio.dec_item_add_content("SID : Secure invasive isn't supported");
                                ScanaStudio.dec_item_add_content("Secure invasive isn't supported");
                                ScanaStudio.dec_item_add_content("SID : Isn't supported");
                            }
                            else
                            {
                                packet_string = "Is supported";
                                ScanaStudio.dec_item_add_content("SID : Secure invasive is supported");
                                ScanaStudio.dec_item_add_content("Secure invasive is supported");
                                ScanaStudio.dec_item_add_content("SID : Is supported");
                            }
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"AUTHSTATUS.SID",packet_string,types);
                        // SNID bits
                        nbits = 2;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        swd_value = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        types = "Data";
                        if (AP_Memory == "MEM-AP")
                        {
                            if (swd_value == 0)
                            {
                                packet_string = "Isn't supported";
                                ScanaStudio.dec_item_add_content("SNID : Secure noninvasive debug isn't supported");
                                ScanaStudio.dec_item_add_content("Secure noninvasive debug isn't supported");
                                ScanaStudio.dec_item_add_content("SNID : Isn't supported");
                            }
                            else
                            {
                                packet_string = "For MEM-AP it should be 0";
                                ScanaStudio.dec_item_add_content("SNID : For MEM-AP this field should be 0");
                                ScanaStudio.dec_item_add_content("For MEM-AP this field should be 0");
                            }
                        }
                        else if (AP_Memory == "JTAG-AP")
                        {
                            if (SDeviceEn == 0)
                            {
                                if (swd_value == 2)
                                {
                                    packet_string = "Is supported";
                                    ScanaStudio.dec_item_add_content("SNID : Secure noninvasive debug is supported");
                                    ScanaStudio.dec_item_add_content("Secure noninvasive debug is supported");
                                    ScanaStudio.dec_item_add_content("SNID : Is supported");
                                }
                                else
                                {
                                    packet_string = "For JTAG-AP it should be 2";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("SNID : For JTAG-AP this field should be 2");
                                    ScanaStudio.dec_item_add_content("For JTAG-AP this field should be 2");
                                }
                            }
                            else if (SDeviceEn == 1)
                            {
                                if (swd_value == 2)
                                {
                                    packet_string = "Is supported";
                                    ScanaStudio.dec_item_add_content("SNID : Secure noninvasive debug is supported and (SPIDEN | SPNIDEN) & (DBGEN | NIDEN) == true");
                                    ScanaStudio.dec_item_add_content("Secure noninvasive debug is supported");
                                    ScanaStudio.dec_item_add_content("SNID : Is supported");
                                }
                                else
                                {
                                    packet_string = "For JTAG-AP it should be 3";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("SNID : For JTAG-AP this field should be 3");
                                    ScanaStudio.dec_item_add_content("For JTAG-AP this field should be 3");
                                }
                            }
                        }
                        else // Other AP than MEM/JTAG-AP
                        {
                            if (swd_value == 0)
                            {
                                packet_string = "Secure noninvasive debug isn't supported";
                                ScanaStudio.dec_item_add_content("SNID : Secure noninvasive debug isn't supported");
                                ScanaStudio.dec_item_add_content("Secure noninvasive debug isn't supported");
                                ScanaStudio.dec_item_add_content("SNID : Isn't supported");
                            }
                            else
                            {
                                packet_string = "Secure noninvasive debug is supported";
                                ScanaStudio.dec_item_add_content("SNID : Secure noninvasive debug is supported");
                                ScanaStudio.dec_item_add_content("Secure noninvasive debug is supported");
                                ScanaStudio.dec_item_add_content("SNID : Is supported");
                            }
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"AUTHSTATUS.SNID",packet_string,types);
                        // HID bits
                        nbits = 2;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        swd_value = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        types = "Data";
                        if (AP_Memory == "MEM-AP" || AP_Memory == "JTAG-AP")
                        {
                            if (swd_value == 0)
                            {
                                packet_string = "Isn't supported";
                                ScanaStudio.dec_item_add_content("HID : Hypervisor invasive debug isn't supported");
                                ScanaStudio.dec_item_add_content("Hypervisor invasive debug isn't supported");
                                ScanaStudio.dec_item_add_content("HID : Isn't supported");
                            }
                            else
                            {
                                packet_string = "For MEM-AP it should be 0";
                                ScanaStudio.dec_item_add_content("HID : For " + AP_Memory + " this field should be 0");
                                ScanaStudio.dec_item_add_content("For MEM-AP this field should be 0");
                            }
                        }
                        else // Other AP than MEM/JTAG-AP
                        {
                            if (swd_value == 0)
                            {
                                packet_string = "Isn't supported";
                                ScanaStudio.dec_item_add_content("HID : Hypervisor invasive debug isn't supported");
                                ScanaStudio.dec_item_add_content("Hypervisor invasive debug isn't supported");
                                ScanaStudio.dec_item_add_content("HID : Isn't supported");
                            }
                            else
                            {
                                packet_string = "Is supported";
                                ScanaStudio.dec_item_add_content("HID : Hypervisor invasive debug is supported");
                                ScanaStudio.dec_item_add_content("Hypervisor invasive debug is supported");
                                ScanaStudio.dec_item_add_content("HID : Is supported");
                            }
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"AUTHSTATUS.HID",packet_string,types);
                        // HNID bits
                        nbits = 2;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        swd_value = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        types = "Data";
                        if (AP_Memory == "MEM-AP" || AP_Memory == "JTAG-AP")
                        {
                            if (swd_value == 0)
                            {
                                packet_string = "Isn't supported";
                                ScanaStudio.dec_item_add_content("HNID : Hypervisor noninvasive debug isn't supported");
                                ScanaStudio.dec_item_add_content("Hypervisor noninvasive debug isn't supported");
                                ScanaStudio.dec_item_add_content("HNID : Isn't supported");
                            }
                            else
                            {
                                packet_string = "For MEM-AP it should be 0";
                                ScanaStudio.dec_item_add_content("HNID : For " + AP_Memory + " this field should be 0");
                                ScanaStudio.dec_item_add_content("For MEM-AP this field should be 0");
                            }
                        }
                        else // Other AP than MEM/JTAG-AP
                        {
                            if (swd_value == 0)
                            {
                                packet_string = "Isn't supported";
                                ScanaStudio.dec_item_add_content("HNID : Hypervisor noninvasive debug isn't supported");
                                ScanaStudio.dec_item_add_content("Hypervisor noninvasive debug isn't supported");
                                ScanaStudio.dec_item_add_content("HNID : Isn't supported");
                            }
                            else
                            {
                                packet_string = "Is supported";
                                ScanaStudio.dec_item_add_content("HNID :Hypervisor noninvasive debug is supported");
                                ScanaStudio.dec_item_add_content("Hypervisor noninvasive debug is supported");
                                ScanaStudio.dec_item_add_content("HNID : Is supported");
                            }
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"AUTHSTATUS.HNID",packet_string,types);
                        //RES0
                        nbits = 20;
                        RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                        break;
                    }//end case AUTHSTATUS


                    case "DEVARCH" : // Device Architecture Register
                    {
                        // ARCHID bits
                        nbits = 16;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        swd_value = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (swd_value == 2583) // 0x0A17
                        {
                            packet_string = "MEM-AP";
                            ScanaStudio.dec_item_add_content("ARCHID : MEM-AP 0x");
                            ScanaStudio.dec_item_add_content("MEM-AP 0x");
                        }
                        else if (swd_value == 2599) // 0x0A27
                        {
                            packet_string = "JTAG-AP";
                            ScanaStudio.dec_item_add_content("ARCHID : JTAG-AP");
                            ScanaStudio.dec_item_add_content("JTAG-AP");
                        }
                        else if (swd_value == 2631) // 0x0A47
                        {
                            packet_string = "Unknown AP 0x" + pad(swd_value.toString(16),4);
                            ScanaStudio.dec_item_add_content("ARCHID : Unknown AP, access to the IDR Register to get more information about it");
                            ScanaStudio.dec_item_add_content("Unknown AP, access to the IDR Register to get more information about it");
                        }
                        else
                        {
                            packet_string = "0x" + pad(swd_value.toString(16),4);
                            ScanaStudio.dec_item_add_content("ARCHID : 0x" + pad(swd_value.toString(16),4) + ", use IDR Register in the AP to determine more information about it");
                            ScanaStudio.dec_item_add_content("0x" + pad(swd_value.toString(16),4) + ", use IDR Register in the AP to determine more information about it");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"DEVARCH.ARCHID",packet_string,"Data");
                        // REVISION bits
                        nbits = 4;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        swd_value = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (swd_value == 0) // 0x0
                        {
                            packet_string = "Revision 0";
                            types = "Data";
                            ScanaStudio.dec_item_add_content("REVISION : Revision 0");
                            ScanaStudio.dec_item_add_content("Revision 0");
                        }
                        else
                        {
                            packet_string = "Should be Revision 0";
                            types = "Error";
                            ScanaStudio.dec_item_add_content("REVISION : Should be Revision 0");
                            ScanaStudio.dec_item_add_content("Should be Revision 0");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"DEVARCH.REVISION",packet_string,types);
                        // PRESENT bits
                        nbits = 1;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        swd_value = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (swd_value == 1) // 0b1
                        {
                            packet_string = "Present";
                            types = "Data";
                            ScanaStudio.dec_item_add_content("PRESENT : Present");
                            ScanaStudio.dec_item_add_content("Present");
                        }
                        else
                        {
                            packet_string = "Should be Present";
                            types = "Error";
                            ScanaStudio.dec_item_add_content("PRESENT : Should be Present");
                            ScanaStudio.dec_item_add_content("Should be Present");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"DEVARCH.PRESENT",packet_string,types);
                        // ARCHITECT bits
                        nbits = 11;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        swd_value = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (swd_value == 571) // 0x23B
                        {
                            packet_string = "ARM";
                            types = "Data";
                            ScanaStudio.dec_item_add_content("ARCHITECT : ARM");
                            ScanaStudio.dec_item_add_content("ARM");
                        }
                        else
                        {
                            packet_string = "Should be ARM";
                            types = "Error";
                            ScanaStudio.dec_item_add_content("ARCHITECT : Should be ARM");
                            ScanaStudio.dec_item_add_content("Should be ARM");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"DEVARCH.ARCHITECT",packet_string,types);
                        break;
                    }//end case DEVARCH

                    case "DEVID" : // Device Configuration Registers
                    {
                        //RES0
                        nbits = 32;
                        RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                        break;
                    }//end case DEVID

                    case "DEVTYPE" : // Device Type Register
                    {
                        // MAJOR bits
                        nbits = 4;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        swd_value = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (swd_value == 0) // 0x0
                        {
                            packet_string = "Miscellaneous";
                            types = "Misc";
                            ScanaStudio.dec_item_add_content("MAJOR : Miscellaneous");
                            ScanaStudio.dec_item_add_content("Miscellaneous");
                        }
                        else
                        {
                            packet_string = "Should be 0";
                            types = "Error";
                            ScanaStudio.dec_item_add_content("MAJOR : Should be 0");
                            ScanaStudio.dec_item_add_content("Should be 0");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"DEVTYPE.MAJOR",packet_string,types);
                        // SUB bits
                        nbits = 4;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        swd_value = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        if (swd_value == 0) // 0x0
                        {
                            packet_string = "Other, undefined";
                            types = "Misc";
                            ScanaStudio.dec_item_add_content("SUB : Other, undefined");
                            ScanaStudio.dec_item_add_content("Other, undefined");
                        }
                        else
                        {
                            packet_string = "Should be 0";
                            types = "Error";
                            ScanaStudio.dec_item_add_content("SUB : Should be 0");
                            ScanaStudio.dec_item_add_content("Should be 0");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"DEVTYPE.SUB",packet_string,types);
                        //RES0
                        nbits = 24;
                        RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                        break;
                    }//end case DEVTYPE

                    case "PIDR" : // Peripheral Identification Register
                    {
                        if (AP_Adress == 253) // 0xFD
                        {
                            if (Adress == 0) // PIDR_4
                            {
                                // DES_2 bits
                                nbits = 4;
                                swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_io();
                                    break;
                                }
                                item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                                swd_value = Number(swd_simple.unsigned_words);
                                dec_item_new_v2(ch_io,swd_simple);
                                ScanaStudio.dec_item_add_content("DES_2 : 0x" + pad(swd_value.toString(16),1));
                                ScanaStudio.dec_item_add_content("0x" + pad(swd_value.toString(16),1));
                                display_sample(swd_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = "0x" + pad(swd_value.toString(16),1);
                                packet_view_add_packet_v2(ch_io,swd_simple,"PIDR_4.DES_2",packet_string,"Data");
                                // SIZE bits
                                nbits = 4;
                                swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_io();
                                    break;
                                }
                                item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                                swd_value = Number(swd_simple.unsigned_words);
                                dec_item_new_v2(ch_io,swd_simple);
                                if (swd_value == 0)
                                {
                                    packet_string = "This field is deprecated, 0 means we can't determine the size";
                                    ScanaStudio.dec_item_add_content("SIZE : This field is deprecated, 0 means we can't determine the size");
                                    ScanaStudio.dec_item_add_content("This field is deprecated, 0 means we can't determine the size");
                                }
                                else
                                {
                                    packet_string = Math.floor(Math.log(swd_value)/Math.log(2)) + " 4KB block";
                                    ScanaStudio.dec_item_add_content("SIZE : " + Math.floor(Math.log(swd_value)/Math.log(2)) + " 4KB block"); // Idk if we can take a part of 4KB block.
                                    ScanaStudio.dec_item_add_content(Math.floor(Math.log(swd_value)/Math.log(2)) + " 4KB block");
                                }
                                display_sample(swd_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_io,swd_simple,"PIDR_4.SIZE",packet_string,"Data");
                                //RES0
                                nbits = 24;
                                RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                            }//end case PIDR_4
                            else // PIDR_5/6/7 are RES0
                            {
                                //RES0
                                nbits = 32;
                                RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                            }//end case PIDR_5/6/7
                        }//end if (AP_Adress == 253)
                        else if (AP_Adress == 254)
                        {
                            switch (Adress)
                            {
                                case 0 : //PIDR_0
                                {
                                    // PART_0 bits
                                    nbits = 8;
                                    swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                                    if (last_trans == true) //if sync_decode overpassed the last sample
                                    {
                                        go_to_last_trans_io();
                                        break;
                                    }
                                    item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                                    PART_0 = Number(swd_simple.unsigned_words);
                                    dec_item_new_v2(ch_io,swd_simple);
                                    ScanaStudio.dec_item_add_content("PART_0 [7:0] : 0x" + pad(PART_0.toString(16),2));
                                    ScanaStudio.dec_item_add_content("0x" + pad(PART_0.toString(16),2));
                                    display_sample(swd_simple);
                                    ScanaStudio.dec_item_end();
                                    //Packet View
                                    packet_string = "[7:0] : 0x" + pad(PART_0.toString(16),2);
                                    packet_view_add_packet_v2(ch_io,swd_simple,"PIDR_0.PART_0",packet_string,"Data");
                                    break;
                                }//end case 0

                                case 4 : //PIDR_1
                                {
                                    // PART_1 bits
                                    nbits = 4;
                                    swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                                    if (last_trans == true) //if sync_decode overpassed the last sample
                                    {
                                        go_to_last_trans_io();
                                        break;
                                    }
                                    item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                                    PART_1 = Number(swd_simple.unsigned_words);
                                    dec_item_new_v2(ch_io,swd_simple);
                                    ScanaStudio.dec_item_add_content("PART_1 [11:8] : 0x" + pad(PART_1.toString(16),1));
                                    ScanaStudio.dec_item_add_content("0x" + pad(PART_1.toString(16),1));
                                    display_sample(swd_simple);
                                    ScanaStudio.dec_item_end();
                                    //Packet View
                                    packet_string = "[11:8] : 0x" + pad(PART_1.toString(16),1);
                                    packet_view_add_packet_v2(ch_io,swd_simple,"PIDR_0.PART_1",packet_string,"Data");
                                    // DES_0 bits
                                    nbits = 4;
                                    swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                                    if (last_trans == true) //if sync_decode overpassed the last sample
                                    {
                                        go_to_last_trans_io();
                                        break;
                                    }
                                    item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                                    DES_0 = Number(swd_simple.unsigned_words);
                                    dec_item_new_v2(ch_io,swd_simple);
                                    ScanaStudio.dec_item_add_content("DES_0 [3:0] : 0x" + pad(DES_0.toString(16),1));
                                    ScanaStudio.dec_item_add_content("0x" + pad(DES_0.toString(16),1));
                                    display_sample(swd_simple);
                                    ScanaStudio.dec_item_end();
                                    //Packet View
                                    packet_string = "[3:0] 0x" + pad(DES_0.toString(16),1);
                                    packet_view_add_packet_v2(ch_io,swd_simple,"PIDR_1.DES_0",packet_string,"Data");
                                    break;
                                }//end case 4

                                case 8 : //PIDR_2
                                {
                                    // DES_1 bits
                                    nbits = 3;
                                    swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                                    if (last_trans == true) //if sync_decode overpassed the last sample
                                    {
                                        go_to_last_trans_io();
                                        break;
                                    }
                                    item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                                    DES_1 = Number(swd_simple.unsigned_words);
                                    dec_item_new_v2(ch_io,swd_simple);
                                    ScanaStudio.dec_item_add_content("DES_1 [6:4] : 0x" + pad(DES_1.toString(16),1));
                                    ScanaStudio.dec_item_add_content("0x" + pad(DES_1.toString(16),1));
                                    display_sample(swd_simple);
                                    ScanaStudio.dec_item_end();
                                    //Packet View
                                    packet_string = "[6:4] 0x" + pad(DES_1.toString(16),1);
                                    packet_view_add_packet_v2(ch_io,swd_simple,"PIDR_2.DES_1",packet_string,"Data");
                                    // JEDEC bits
                                    nbits = 1;
                                    swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                                    if (last_trans == true) //if sync_decode overpassed the last sample
                                    {
                                        go_to_last_trans_io();
                                        break;
                                    }
                                    item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                                    swd_value = Number(swd_simple.unsigned_words);
                                    dec_item_new_v2(ch_io,swd_simple);
                                    if (swd_value == 1)
                                    {
                                        packet_string = "JEDEC-assigned value is used";
                                        types = "Data";
                                        ScanaStudio.dec_item_add_content("JEDEC : JEDEC-assigned value is used");
                                        ScanaStudio.dec_item_add_content("JEDEC-assigned value is used");
                                    }
                                    else
                                    {
                                        packet_string = "Must be 0b1";
                                        types = "Error";
                                        ScanaStudio.dec_item_add_content("JEDEC : Must be 0b1 to indicate that a JEDEC-assigned value is used.");
                                        ScanaStudio.dec_item_add_content("Must be 0b1 to indicate that a JEDEC-assigned value is used.");
                                    }
                                    display_sample(swd_simple);
                                    ScanaStudio.dec_item_end();
                                    //Packet View
                                    packet_view_add_packet_v2(ch_io,swd_simple,"PIDR_2.JEDEC",packet_string,types);
                                    // REVISION bits
                                    nbits = 4;
                                    swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                                    if (last_trans == true) //if sync_decode overpassed the last sample
                                    {
                                        go_to_last_trans_io();
                                        break;
                                    }
                                    item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                                    swd_value = Number(swd_simple.unsigned_words);
                                    dec_item_new_v2(ch_io,swd_simple);
                                    if (swd_value == 0)
                                    {
                                        packet_string = "First implementation of a component";
                                        ScanaStudio.dec_item_add_content("REVISION : First implementation of a component");
                                        ScanaStudio.dec_item_add_content("First implementation of a component");
                                    }
                                    else
                                    {
                                        packet_string = "This component had 0x" + pad(swd_value.toString(16),1) + " Major/Minor revisions";
                                        ScanaStudio.dec_item_add_content("REVISION : This component had 0x" + pad(swd_value.toString(16),1) + " Major/Minor revisions");
                                        ScanaStudio.dec_item_add_content("This component had 0x" + pad(swd_value.toString(16),1) + " Major/Minor revisions");
                                    }
                                    display_sample(swd_simple);
                                    ScanaStudio.dec_item_end();
                                    //Packet View
                                    packet_view_add_packet_v2(ch_io,swd_simple,"PIDR_2.REVISION",packet_string,"Data");
                                    break;
                                }//end case 8

                                case 12 : //PIDR_3
                                {
                                    // CMOD bits
                                    nbits = 4;
                                    swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                                    if (last_trans == true) //if sync_decode overpassed the last sample
                                    {
                                        go_to_last_trans_io();
                                        break;
                                    }
                                    item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                                    swd_value = Number(swd_simple.unsigned_words);
                                    dec_item_new_v2(ch_io,swd_simple);
                                    if (swd_value == 0)
                                    {
                                        packet_string = "Component hasn't been modified.";
                                        ScanaStudio.dec_item_add_content("CMOD : The component is not modified from the original design");
                                        ScanaStudio.dec_item_add_content("The component is not modified from the original design");
                                    }
                                    else
                                    {
                                        packet_string = "The component has been modified.";
                                        ScanaStudio.dec_item_add_content("CMOD : The component has been modified, read documentation to determine the modifications");
                                        ScanaStudio.dec_item_add_content("The component has been modified, read documentation to determine the modifications");
                                        ScanaStudio.dec_item_add_content("The component has been modified");
                                    }
                                    display_sample(swd_simple);
                                    ScanaStudio.dec_item_end();
                                    //Packet View
                                    packet_view_add_packet_v2(ch_io,swd_simple,"PIDR_3.CMOD",packet_string,"Data");
                                    // REVAND bits
                                    nbits = 4;
                                    swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                                    if (last_trans == true) //if sync_decode overpassed the last sample
                                    {
                                        go_to_last_trans_io();
                                        break;
                                    }
                                    item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                                    swd_value = Number(swd_simple.unsigned_words);
                                    dec_item_new_v2(ch_io,swd_simple);
                                    if (swd_value == 0)
                                    {
                                        packet_string = "No minor errata fixes";
                                        ScanaStudio.dec_item_add_content("REVAND : No minor errata fixes");
                                        ScanaStudio.dec_item_add_content("No minor errata fixes");
                                    }
                                    else
                                    {
                                        packet_string = "Minor errata fixes : 0x" + pad(swd_value.toString(16),1);
                                        ScanaStudio.dec_item_add_content("REVAND : Number of minor errata fixes : 0x" + pad(swd_value.toString(16),1));
                                        ScanaStudio.dec_item_add_content("Number of minor errata fixes : 0x" + pad(swd_value.toString(16),1));
                                    }
                                    display_sample(swd_simple);
                                    ScanaStudio.dec_item_end();
                                    //Packet View
                                    packet_view_add_packet_v2(ch_io,swd_simple,"PIDR_3.REVAND",packet_string,"Data");
                                    break;
                                }//end case 12
                            }//end switch (Adress)
                            //RES0
                            nbits = 24;
                            RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                        }//end else if (AP_Adress == 254)
                        break;
                    }//end case PIDR

                    case "CIDR" :
                    {
                        switch (Adress)
                        {
                            case 0 : //CIDR0
                            {
                                // PRMBL_0 bits
                                nbits = 8;
                                swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_io();
                                    break;
                                }
                                item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                                swd_value = Number(swd_simple.unsigned_words);
                                dec_item_new_v2(ch_io,swd_simple);
                                if (swd_value == 13) //0x0D
                                {
                                    packet_string = pad(swd_value.toString(16),2);
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("PRMBL_0 : 0x" + pad(swd_value.toString(16),2));
                                    ScanaStudio.dec_item_add_content("0x" + pad(swd_value.toString(16),2));
                                }
                                else
                                {
                                    packet_string = "Should be 0x0D";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("PRMBL_0 : Should be 0x0D");
                                    ScanaStudio.dec_item_add_content("Should be 0x0D");
                                }
                                display_sample(swd_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_io,swd_simple,"CIDR0.PRMBL_0",packet_string,types);
                                break;
                            }//end case 0

                            case 4 : //CIDR1
                            {
                                // PRMBL_1 bits
                                nbits = 4;
                                swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_io();
                                    break;
                                }
                                item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                                swd_value = Number(swd_simple.unsigned_words);
                                dec_item_new_v2(ch_io,swd_simple);
                                if (swd_value == 0) //0x0
                                {
                                    packet_string = pad(swd_value.toString(16),2);
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("PRMBL_1 : 0x" + pad(swd_value.toString(16),2));
                                    ScanaStudio.dec_item_add_content("0x" + pad(swd_value.toString(16),2));
                                }
                                else
                                {
                                    packet_string = "Should be 0x0";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("PRMBL_1 : Should be 0x0");
                                    ScanaStudio.dec_item_add_content("Should be 0x0");
                                }
                                display_sample(swd_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_io,swd_simple,"CIDR1.PRMBL_1",packet_string,types);
                                // CLASS bits
                                nbits = 4;
                                swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_io();
                                    break;
                                }
                                item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                                swd_value = Number(swd_simple.unsigned_words);
                                dec_item_new_v2(ch_io,swd_simple);
                                switch (swd_value)
                                {
                                    case 0 :
                                    {
                                        types = "Data";
                                        ScanaStudio.dec_item_add_content("CLASS : Generic verification component 0x" + pad(swd_value.toString(16),1));
                                        ScanaStudio.dec_item_add_content("CLASS : 0x" + pad(swd_value.toString(16),1));
                                        ScanaStudio.dec_item_add_content("0x" + pad(swd_value.toString(16),1));
                                        break;
                                    }
                                    case 1 :
                                    {
                                        types = "Data";
                                        ScanaStudio.dec_item_add_content("CLASS : ROM Table 0x" + pad(swd_value.toString(16),1));
                                        ScanaStudio.dec_item_add_content("CLASS : 0x" + pad(swd_value.toString(16),1));
                                        ScanaStudio.dec_item_add_content("0x" + pad(swd_value.toString(16),1));
                                        break;
                                    }
                                    case 9 :
                                    {
                                        types = "Data";
                                        ScanaStudio.dec_item_add_content("CLASS : CoreSight component 0x" + pad(swd_value.toString(16),1));
                                        ScanaStudio.dec_item_add_content("CLASS : 0x" + pad(swd_value.toString(16),1));
                                        ScanaStudio.dec_item_add_content("0x" + pad(swd_value.toString(16),1));
                                        break;
                                    }
                                    case 11 :
                                    {
                                        types = "Data";
                                        ScanaStudio.dec_item_add_content("CLASS : Peripheral Test Block 0x" + pad(swd_value.toString(16),1));
                                        ScanaStudio.dec_item_add_content("CLASS : 0x" + pad(swd_value.toString(16),1));
                                        ScanaStudio.dec_item_add_content("0x" + pad(swd_value.toString(16),1));
                                        break;
                                    }
                                    case 14 :
                                    {
                                        types = "Data";
                                        ScanaStudio.dec_item_add_content("CLASS : Generic IP component 0x" + pad(swd_value.toString(16),1));
                                        ScanaStudio.dec_item_add_content("CLASS : 0x" + pad(swd_value.toString(16),1));
                                        ScanaStudio.dec_item_add_content("0x" + pad(swd_value.toString(16),1));
                                        break;
                                    }
                                    case 15 :
                                    {
                                        types = "Data";
                                        ScanaStudio.dec_item_add_content("CLASS : CoreLink, PrimeCell, or system component with no standardized register layout, for backwards compatibility. 0x" + pad(swd_value.toString(16),1));
                                        ScanaStudio.dec_item_add_content("CLASS : CoreLink, PrimeCell, or system component with no standardized register layout 0x" + pad(swd_value.toString(16),1));
                                        ScanaStudio.dec_item_add_content("CLASS : CoreLink, PrimeCell 0x" + pad(swd_value.toString(16),1));
                                        ScanaStudio.dec_item_add_content("CLASS : 0x" + pad(swd_value.toString(16),1));
                                        ScanaStudio.dec_item_add_content("0x" + pad(swd_value.toString(16),1));
                                        break;
                                    }
                                    default :
                                    {
                                        types = "Data";
                                        ScanaStudio.dec_item_add_content("CLASS : Reserved 0x" + pad(swd_value.toString(16),1));
                                        ScanaStudio.dec_item_add_content("Reserved 0x" + pad(swd_value.toString(16),1));
                                        ScanaStudio.dec_item_add_content("0x" + pad(swd_value.toString(16),1));
                                        break;
                                    }
                                }
                                display_sample(swd_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_string = "0x" + pad(swd_value.toString(16),1);
                                packet_view_add_packet_v2(ch_io,swd_simple,"CIDR1.CLASS",packet_string,types);
                                break;
                            }//end case 4

                            case 8 : //CIDR2
                            {
                                // PRMBL_2 bits
                                nbits = 8;
                                swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_io();
                                    break;
                                }
                                item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                                swd_value = Number(swd_simple.unsigned_words);
                                dec_item_new_v2(ch_io,swd_simple);
                                if (swd_value == 5) //0x05
                                {
                                    packet_string = pad(swd_value.toString(16),2);
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("PRMBL_2 : 0x" + pad(swd_value.toString(16),2));
                                    ScanaStudio.dec_item_add_content("0x" + pad(swd_value.toString(16),2));
                                }
                                else
                                {
                                    packet_string = "Should be 0x05";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("PRMBL_2 : Should be 0x05");
                                    ScanaStudio.dec_item_add_content("Should be 0x05");
                                }
                                display_sample(swd_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_io,swd_simple,"CIDR2.PRMBL_2",packet_string,types);
                                break;
                            }//end case 8

                            case 12 : //CIDR3
                            {
                                // PRMBL_3 bits
                                nbits = 8;
                                swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                                if (last_trans == true) //if sync_decode overpassed the last sample
                                {
                                    go_to_last_trans_io();
                                    break;
                                }
                                item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                                swd_value = Number(swd_simple.unsigned_words);
                                dec_item_new_v2(ch_io,swd_simple);
                                if (swd_value == 177) //0xB1
                                {
                                    packet_string = pad(swd_value.toString(16),2);
                                    types = "Data";
                                    ScanaStudio.dec_item_add_content("PRMBL_3 : 0x" + pad(swd_value.toString(16),2));
                                    ScanaStudio.dec_item_add_content("0x" + pad(swd_value.toString(16),2));
                                }
                                else
                                {
                                    packet_string = "Should be 0xB1";
                                    types = "Error";
                                    ScanaStudio.dec_item_add_content("PRMBL_3 : Should be 0xB1");
                                    ScanaStudio.dec_item_add_content("Should be 0xB1");
                                }
                                display_sample(swd_simple);
                                ScanaStudio.dec_item_end();
                                //Packet View
                                packet_view_add_packet_v2(ch_io,swd_simple,"CIDR3.PRMBL_3",packet_string,types);
                                break;
                            }//end case 12
                        }
                        //RES0
                        nbits = 24;
                        RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                        break;
                    }//end case CIDR

                    case "PSEL" : //Port Select Register
                    {
                        //PSEL7-PSEL0
                        nbits = 8;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        swd_value = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        item_content = "";
                        for (i=0; i<8; i++)
                        {
                            if (item_display[i] == 1)
                            {
                                if (item_content = "")
                                {
                                    item_content = i;
                                }
                                else
                                {
                                    item_content += "/" + i;
                                }
                            }
                        }
                        if (RnW == "Write")
                        {
                            if (SERACTV != 0 || WFIFOCNT != 0)
                            {
                                ScanaStudio.dec_item_add_content("PSEL7-PSEL0 : You MUST only write to this register when CSW.WFIFOCNT and CSW.SERACTV are both zero");
                            }
                            else
                            {
                                if (item_content.length == 1)
                                {
                                    packet_string = "JTAG port " + item_content + " is selected";
                                    ScanaStudio.dec_item_add_content("PSEL7-PSEL0 : JTAG port" + item_content + " is selected");
                                    ScanaStudio.dec_item_add_content("JTAG port" + item_content + " is selected");
                                }
                                else
                                {
                                    packet_string = "JTAG port " + item_content + " are selected";
                                    ScanaStudio.dec_item_add_content("PSEL7-PSEL0 : JTAG port" + item_content + " are selected");
                                    ScanaStudio.dec_item_add_content("JTAG port" + item_content + " are selected");
                                }
                            }
                        }
                        else
                        {
                            if (item_content.length == 1)
                            {
                                packet_string = "JTAG port " + item_content + " is selected";
                                ScanaStudio.dec_item_add_content("PSEL7-PSEL0 : JTAG port" + item_content + " is selected");
                                ScanaStudio.dec_item_add_content("JTAG port" + item_content + " is selected");
                            }
                            else
                            {
                                packet_string = "JTAG port " + item_content + " are selected";
                                ScanaStudio.dec_item_add_content("PSEL7-PSEL0 : JTAG port" + item_content + " are selected");
                                ScanaStudio.dec_item_add_content("JTAG port" + item_content + " are selected");
                            }
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"PSEL.PSEL7-PSEL0",packet_string,"Data");
                        //RES0
                        nbits = 24;
                        RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                        break;
                    }//end case "PSEL"

                    case "PSTA" : //Port Status Register
                    {
                        //PSTA7-PSTA0
                        nbits = 8;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        swd_value = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        item_content = "";
                        for (i=0; i<8; i++)
                        {
                            if (item_display[i] == 1)
                            {
                                if (item_content = "")
                                {
                                    item_content = i;
                                }
                                else
                                {
                                    item_content += "/" + i;
                                }
                            }
                        }
                        if (RnW == "Write")
                        {
                            if ((SERACTV != 0 || WFIFOCNT != 0) && (swd_value != 0))
                            {
                                ScanaStudio.dec_item_add_content("PSTA7-PSTA0 : You MUST only write to this register when CSW.WFIFOCNT and CSW.SERACTV are both zero");
                            }
                            else
                            {
                                packet_string = "Clear PSTA" + item_content + " to 0b0";
                                ScanaStudio.dec_item_add_content("PSTA7-PSTA0 : Clear PSTA" + item_content + " to 0b0");
                                ScanaStudio.dec_item_add_content("Clear PSTA" + item_content + " to 0b0");
                            }
                        }
                        else
                        {
                            packet_string = "JTAG port " + item_content + " has been disabled";
                            ScanaStudio.dec_item_add_content("PSTA7-PSTA0 : JTAG port " + item_content + " has been disabled, others are not disabled OR not connected");
                            ScanaStudio.dec_item_add_content("JTAG port" + item_content + " has been disabled, others are not disabled OR not connected");
                        }
                        display_sample(swd_simple);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"PSTA.PSTA7-PSTA0",packet_string,"Data");
                        //RES0
                        nbits = 24;
                        RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                        break;
                    }//end case "PSTA"

                    case "BRFIFO" : //Byte FIFO registers for read access
                    {
                        nbits_total = 32;
                        //Read 1,2,3,4 Bytes
                        for (i=0; i<=Adress/4; i++)
                        {
                            nbits = 8;
                            nbits_total = nbits_total - nbits;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            swd_value = Number(swd_simple.unsigned_words);
                            dec_item_new_v2(ch_io,swd_simple);
                            var byte_nb = i+1;
                            ScanaStudio.dec_item_add_content("Byte " + byte_nb + " : 0x" + pad(swd_value.toString(16),2));
                            display_sample(swd_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            Title = "BRFIFO.Byte " + byte_nb;
                            packet_string = "0x" + pad(swd_value.toString(16),2);
                            packet_view_add_packet_v2(ch_io,swd_simple,Title,packet_string,"Data");
                        }
                        //RES0
                        nbits = nbits_total;
                        RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                        break;
                    }//end case "BWFIFO"

                    case "BWFIFO" : //Byte FIFO registers for write access
                    {
                        nbits_total = 32;
                        //Read 1,2,3,4 Bytes
                        for (i=0; i<=Adress/4; i++)
                        {
                            nbits = 8;
                            nbits_total = nbits_total - nbits;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            swd_value = Number(swd_simple.unsigned_words);
                            dec_item_new_v2(ch_io,swd_simple);
                            var byte_nb = i+1;
                            ScanaStudio.dec_item_add_content("Byte " + byte_nb + " : 0x" + pad(swd_value.toString(16),2));
                            display_sample(swd_simple);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            Title = "BWFIFO.Byte " + byte_nb;
                            packet_string = "0x" + pad(swd_value.toString(16),2);
                            packet_view_add_packet_v2(ch_io,swd_simple,Title,packet_string,"Data");
                        }
                        //RES0
                        nbits = nbits_total;
                        RES0 (swd_simple.end_sample, nbits, parity_array, Register_name);
                        break;
                    }//end case "BWFIFO"

                    case "Unknown AP" :
                    {
                        // Unknown bits
                        for (i=0; i<4; i++)
                        {
                            nbits = 8;
                            swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                            if (last_trans == true) //if sync_decode overpassed the last sample
                            {
                                go_to_last_trans_io();
                                break;
                            }
                            item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                            swd_value = Number(swd_simple.unsigned_words);
                            dec_item_new_v2(ch_io,swd_simple);
                            display_sample_0_1(swd_simple, item_display);
                            ScanaStudio.dec_item_end();
                            //Packet View
                            packet_view_add_packet_v2(ch_io,swd_simple,"Unknown_AP_Register","Unknown data","Data");
                        }
                        break;
                    }//end case "Unknown AP"

                    case "WO Register" :
                    {
                        // Ignore these bits
                        nbits = 32;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        swd_value = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        ScanaStudio.dec_item_add_content("Ignore these bits");
                        display_sample_0_1(swd_simple, item_display);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"WO Register","Ignore these bits","Misc");
                        break;
                    }//end case "IGNORE DATA"

                    case "IGNORE DATA" :
                    {
                        // Ignore these bits
                        nbits = 32;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        swd_value = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        ScanaStudio.dec_item_add_content("Ignore these bits");
                        display_sample_0_1(swd_simple, item_display);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"IGNORE DATA","Ignore these bits","Misc");
                        break;
                    }//end case "IGNORE DATA"

                    case "UNKNOWN DATA" :
                    {
                        // Unknown bits
                        nbits = 32;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        swd_value = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        ScanaStudio.dec_item_add_content("The data is unknown for the first AP read access");
                        display_sample_0_1(swd_simple, item_display);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,"UNKNOWN DATA","The data is unknown","Data");
                        break;
                    }//end case "UNKNOWN DATA"

                    default :
                    {
                        // Unknown Register
                        nbits = 32;
                        swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                        if (last_trans == true) //if sync_decode overpassed the last sample
                        {
                            go_to_last_trans_io();
                            break;
                        }
                        item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                        swd_value = Number(swd_simple.unsigned_words);
                        dec_item_new_v2(ch_io,swd_simple);
                        ScanaStudio.dec_item_add_content("This register and his data are unknown");
                        display_sample_0_1(swd_simple, item_display);
                        ScanaStudio.dec_item_end();
                        //Packet View
                        packet_view_add_packet_v2(ch_io,swd_simple,Register_name,"The data is unknown","Data");
                        break;
                    }
                    break;
                }//end switch (Register_name)

                //Read parity bit
                nbits = 1;
                swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                if (last_trans == true) //if sync_decode overpassed the last sample
                {
                    go_to_last_trans_io();
                    break;
                }
                swd_value = Number(swd_simple.unsigned_words);
                parity_calculated = get_parity(parity_array);
                /*if (parity_array.length != 32)
                {
                    ScanaStudio.console_info_msg("parity_array.length" + parity_array.length + " Register_name : " + Register_name);
                }*/
                item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
                var end_data = dec_item_new_v2(ch_io,swd_simple)[1];
                if (swd_value == parity_calculated)
                {
                    packet_string = "OK";
                    types = "Check";
                    ScanaStudio.dec_item_add_content("Parity bit OK");
                    ScanaStudio.dec_item_add_content("OK");
                }
                else
                {
                    packet_string = "NOT OK";
                    types = "Error";
                    ScanaStudio.dec_item_add_content("Parity bit NOT OK");
                    ScanaStudio.dec_item_add_content("NOT OK");
                    ScanaStudio.dec_item_emphasize_error();
                }
                display_sample_0_1(swd_simple, item_display);
                ScanaStudio.dec_item_end();
                //Packet View
                packet_view_add_packet_v2(ch_io,swd_simple,"Parity bit",packet_string,types);
                parity_array = [];

                if (ACK != "OK")
                {
                    state_machine = ENUM_STATE_RESET;
                    break;
                }
                //Display who is the driver on the clk line
                var test = ScanaStudio.dec_item_new(ch_clk,start_data,end_data);
                ScanaStudio.dec_item_add_content("DRIVER : " + driver);
                ScanaStudio.dec_item_end();

                if (RnW == "Read")
                {
                    //Read Turnaround bits
                    nbits = Turnaround_period + 1;
                    swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
                    if (last_trans == true) //if sync_decode overpassed the last sample
                    {
                        go_to_last_trans_io();
                        break;
                    }
                    swd_value = Number(swd_simple.unsigned_words);
                    var trs_start = ScanaStudio.trs_get_before(ch_clk,swd_simple.start_sample + 1);
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
                    ScanaStudio.dec_item_new(ch_io,trs_start.sample_index,swd_simple.end_sample - 1);
                    ScanaStudio.dec_item_add_content("Turnaround bits");
                    ScanaStudio.dec_item_add_content("Trn");
                    ScanaStudio.dec_item_end();
                    // Display the driver on the clk line
                    ScanaStudio.dec_item_new(ch_clk,trs_start.sample_index + 1,swd_simple.end_sample - 1);
                    ScanaStudio.dec_item_add_content("Driver : No one");
                    ScanaStudio.dec_item_end();
                    //Packet View
                    packet_view_add_packet_v2(ch_io,swd_simple,"Trn","Turnaround bits","Misc");
                    driver = "Host";
                }

                while (trs_io.sample_index < swd_simple.end_sample)
                {
                    if (!ScanaStudio.trs_is_not_last(ch_io))
                    {
                        break;
                    }
                    trs_io = ScanaStudio.trs_get_next(ch_io);
                }
                last_APnDP = APnDP;
                last_RnW = RnW;
                state_machine = ENUM_STATE_REQUEST;
                break;
            }//end ENUM_STATE_DATA_TRANSFER

            case ENUM_STATE_RESET :
            {
                if (first == true)
                {
                    trs_clk = ScanaStudio.trs_get_before(ch_clk, swd_simple.end_sample + 1);
                    tmp_trs_sample_index = trs_clk.sample_index;
                    while( (tmp_trs_sample_index == trs_clk.sample_index) && (ScanaStudio.trs_is_not_last(ch_clk) == true) )
                    {
                        trs_clk = ScanaStudio.trs_get_next(ch_clk); // end of HIGH value
                    }
                    var start_search = trs_clk.sample_index;
                    first = false;
                }
                current_start_sample = swd_simple.end_sample;
                swd_simple.unsigned_words = 0;
                while (swd_simple.unsigned_words == 0)
                {
                    nbits = 1;
                    swd_simple = sync_decode_v2(io_channel, current_start_sample + 1,nbits);
                    if (last_trans == true) //if sync_decode overpassed the last sample
                    {
                        go_to_last_trans_io();
                        break;
                    }
                    current_start_sample = swd_simple.end_sample;
                }
                nbits = 50;
                reset_sequence = sync_decode_v2(io_channel, swd_simple.end_sample - 1, nbits);
                if (last_trans == true) //if sync_decode overpassed the last sample
                {
                    go_to_last_trans_io();
                    break;
                }
                var test = 0;
                for (i=0; i<50; i++)
                {
                    if (reset_sequence.signed_words[i] == 0)
                    {
                        test = 1;
                        break;
                    }
                }
                if (test == 1)
                {
                    break;
                }
                // Display the search of reset sequence
                var end_reset_search = ScanaStudio.trs_get_before(ch_io,reset_sequence.start_sample);
                ScanaStudio.dec_item_new(ch_io,start_search + 1, end_reset_search.sample_index - 1);
                ScanaStudio.dec_item_add_content("Search for a reset sequence");
                ScanaStudio.dec_item_end();
                // Display the driver on the clk line
                ScanaStudio.dec_item_new(ch_clk,start_search + 1, end_reset_search.sample_index - 1);
                ScanaStudio.dec_item_add_content("Driver : Host");
                ScanaStudio.dec_item_end();
                dec_item_new_v2(ch_io, reset_sequence);
                ScanaStudio.dec_item_add_content("Reset Sequence, go back to normal state");
                ScanaStudio.dec_item_end();
                // packet_view
                trs_io = ScanaStudio.trs_get_before(ch_io,swd_simple.start_sample);
                var start_reset = trs_io.sample_index;
                var tmp_trs_sample_index;
                tmp_trs_sample_index = trs_io.sample_index;
                while( (tmp_trs_sample_index == trs_io.sample_index) && (ScanaStudio.trs_is_not_last(ch_io) == true) )
                {
                    trs_io = ScanaStudio.trs_get_next(ch_io); // end of HIGH value
                }
                var end_reset = trs_io.sample_index;
                ScanaStudio.packet_view_add_packet(true,ch_io,reset_sequence.start_sample + 1,reset_sequence.end_sample - 1,"RESET SEQUENCE","50 clocks with SWDIOTMS HIGH",ScanaStudio.PacketColors.Preamble.Title,ScanaStudio.PacketColors.Preamble.Content);
                var start_idle = end_reset;
                trs_io = ScanaStudio.trs_get_next(ch_io); //END of idle cycles
                var end_idle = trs_io.sample_index;
                ScanaStudio.dec_item_new(ch_io,start_idle + 1,end_idle - 1);
                ScanaStudio.dec_item_add_content("Idles Cycles");
                ScanaStudio.dec_item_end();
                // packet_view
                ScanaStudio.packet_view_add_packet(false,ch_io,start_idle,end_idle,"RESET SEQUENCE","IDLE CYCLES",ScanaStudio.PacketColors.Misc.Title,ScanaStudio.PacketColors.Misc.Content);
                // Display the driver on the clk line
                ScanaStudio.dec_item_new(ch_clk,end_reset_search.sample_index + 1,end_idle - 1);
                ScanaStudio.dec_item_add_content("Driver : Host");
                ScanaStudio.dec_item_end();
                Protocol_State = "Reset";
                DP_BANK_SEL = 0;
                Turnaround_period = 1;
                first = true;
                state_machine = ENUM_STATE_REQUEST;
                break;
            }//end case ENUM_STATE_RESET
        }//end switch (state_machine)
    }//end while (ScanaStudio.abort_is_requested() == false)
}//end on_decode_signals

//Trigger sequence GUI
function on_draw_gui_trigger()
{

  ScanaStudio.gui_add_new_selectable_containers_group("trig_alternative","Select trigger alternative");
    ScanaStudio.gui_add_new_container("Trigger on a specific request (combo_box)",true); // trig_alternative = 0
        ScanaStudio.gui_add_combo_box("APnDP_trig","APnDP");
        ScanaStudio.gui_add_item_to_combo_box("DP",true);
        ScanaStudio.gui_add_item_to_combo_box("AP",false);
        ScanaStudio.gui_add_combo_box("RnW_trig","RnW");
        ScanaStudio.gui_add_item_to_combo_box("Write",true);
        ScanaStudio.gui_add_item_to_combo_box("Read",false);
        ScanaStudio.gui_add_combo_box("Adress_trig","A[2:3]");
        ScanaStudio.gui_add_item_to_combo_box("0x0", true);
        ScanaStudio.gui_add_item_to_combo_box("0x4", false);
        ScanaStudio.gui_add_item_to_combo_box("0x8", false);
        ScanaStudio.gui_add_item_to_combo_box("0xC", false);
        ScanaStudio.gui_end_container();

        ScanaStudio.gui_add_new_container("Trigger on a specific request (value)",false); // trig_alternative = 1
        ScanaStudio.gui_add_text_input("trig_request","Trigger request value","0xA5");
        ScanaStudio.gui_add_info_label("Choose a request value between 129 and 189." +
        " The field can accept decimal value (165), hex value (0x)."
         + "The value represent the 8 bits of the request." );

        ScanaStudio.gui_end_container();

        ScanaStudio.gui_add_new_container("Trigger on any reset sequence",false); // trig_alternative = 2
        ScanaStudio.gui_end_container();
  ScanaStudio.gui_end_selectable_containers_group("");
}//end on_draw_gui_trigger

function on_eval_gui_trigger()
{
    if (ScanaStudio.gui_get_value("trig_request") > 189 || ScanaStudio.gui_get_value("trig_request") < 129)
    {
      return "Invalid trigger command, please select a number between 129 and 189";
    }
    if (ScanaStudio.gui_get_value("trig_request").search("\"") >= 0)
    {
      return "Trigger word field contains invalid characters";
    }

    return "";
}//end on_eval_gui_trigger

function on_build_trigger()
{
  var trig_request = Number(ScanaStudio.gui_get_value("trig_request"));
  var APnDP_trig = Number(ScanaStudio.gui_get_value("APnDP_trig"));
  var RnW_trig = Number(ScanaStudio.gui_get_value("RnW_trig"));
  var Adress_trig = Number(ScanaStudio.gui_get_value("Adress_trig"));
  var trig_alternative = Number(ScanaStudio.gui_get_value("trig_alternative"));
  var bit_array = [];
  var parity_number = 0;
  // Reload Decoder GUI values (global variables)
  reload_dec_gui_values();

  var swd_step = {io: "X", clk: "X"};
  var swd_trig_steps = [];
  swd_trig_steps.length = 0;

  if (trig_alternative == 0) //Trigger on a specific request (combo_box)
  {
      // Start
      swd_step.io = "1";
      swd_step.clk = "R";
      swd_trig_steps.push(new SwdTrigStep(swd_step.io, swd_step.clk));
      // APnDP
      if (APnDP_trig == 1)
      {
          parity_number ++;
      }
      swd_step.io = APnDP_trig.toString();
      swd_step.clk = "R";
      swd_trig_steps.push(new SwdTrigStep(swd_step.io, swd_step.clk));
      // RnW
      if (RnW_trig == 1)
      {
          parity_number ++;
      }
      swd_step.io = RnW_trig.toString();
      swd_step.clk = "R";
      swd_trig_steps.push(new SwdTrigStep(swd_step.io, swd_step.clk));
      // A[2:3]
      switch (Adress_trig)
      {
          case 0 : //0x0
          {
              swd_step.io = "0";
              swd_step.clk = "R";
              swd_trig_steps.push(new SwdTrigStep(swd_step.io, swd_step.clk));
              swd_step.io = "0";
              swd_step.clk = "R";
              swd_trig_steps.push(new SwdTrigStep(swd_step.io, swd_step.clk));
              break;
          }
          case 1 : //0x4
          {
              swd_step.io = "1";
              swd_step.clk = "R";
              swd_trig_steps.push(new SwdTrigStep(swd_step.io, swd_step.clk));
              swd_step.io = "0";
              swd_step.clk = "R";
              swd_trig_steps.push(new SwdTrigStep(swd_step.io, swd_step.clk));
              parity_number ++;
              break;
          }
          case 2 : //0x8
          {
              swd_step.io = "0";
              swd_step.clk = "R";
              swd_trig_steps.push(new SwdTrigStep(swd_step.io, swd_step.clk));
              swd_step.io = "1";
              swd_step.clk = "R";
              swd_trig_steps.push(new SwdTrigStep(swd_step.io, swd_step.clk));
              parity_number ++;
              break;
          }
          case 3 : //0xC
          {
              swd_step.io = "1";
              swd_step.clk = "R";
              swd_trig_steps.push(new SwdTrigStep(swd_step.io, swd_step.clk));
              swd_step.io = "1";
              swd_step.clk = "R";
              swd_trig_steps.push(new SwdTrigStep(swd_step.io, swd_step.clk));
              parity_number = parity_number + 2;
              break;
          }
      }
      // Parity
      swd_step.io = parity_calcul(parity_number);
      swd_step.clk = "R";
      swd_trig_steps.push(new SwdTrigStep(swd_step.io, swd_step.clk));
      // Stop
      swd_step.io = "0";
      swd_step.clk = "R";
      swd_trig_steps.push(new SwdTrigStep(swd_step.io, swd_step.clk));
      // Park
      swd_step.io = "1";
      swd_step.clk = "R";
      swd_trig_steps.push(new SwdTrigStep(swd_step.io, swd_step.clk));
  }//end trigger on a specific request (combo_box)

  else if (trig_alternative == 1) //Trigger on a specific request (value)
  {
      trig_request = Number(trig_request);
      for (n=7; n>=0; n--)
      {
          swd_step.io = (trig_request>>n)&0x1.toString();
          swd_step.clk = "R";
          swd_trig_steps.push(new SwdTrigStep(swd_step.io, swd_step.clk));
      }
  }//end trigger on a specific request (value)

  else if (trig_alternative == 2) // Trigger on any reset sequence
  {
      for (i=0; i<50; i++)
      {
          swd_step.clk = "R";
          swd_step.io = "1";
          swd_trig_steps.push(new SwdTrigStep(swd_step.io, swd_step.clk));
      }
  }//end trigger on any reset sequence

  for (i = 0; i < swd_trig_steps.length; i++)
  {
      ScanaStudio.flexitrig_append(trig_build_step(swd_trig_steps[i]), -1, -1);
  }
  ScanaStudio.flexitrig_print_steps();
}//end on_build_trigger

function parity_calcul(nb_high_value) //return parity_bit
{
    if (nb_high_value%2 == 1)
    {
        return "1";
    }
    else
    {
        return "0";
    }
}

function SwdTrigStep (io, clk)
{
	this.io = io;
	this.clk  = clk;
};



function trig_build_step (step_desc)
{
	var i;
	var step = "";

	for (i = 0; i < ScanaStudio.get_device_channels_count(); i++)
	{
        switch (i)
        {
            case ch_io: step = step_desc.io + step; break;
            case ch_clk: step = step_desc.clk + step; break;
            default:      step = "X" + step; break;
        }
	}
	return step;
}


//Function called to generate demo signals (when no physical device is attached)
function on_build_demo_signals()
{
    //Use the function below to get the number of samples to be built
    var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
    var swd_builder = ScanaStudio.BuilderObject;
    var sample_rate = ScanaStudio.builder_get_sample_rate();
    var ch_io = ScanaStudio.gui_get_value("ch_io");
    var ch_clk = ScanaStudio.gui_get_value("ch_clk");
    var sdio_f = 10000; // 10000Hz
    var sample_per_clock = sample_rate/sdio_f;
    var silence_period = samples_to_build/300;
    reload_dec_gui_values();
    Turnaround_period = 1;
    swd_builder.config(ch_io,ch_clk,sdio_f);
    RnW = "Write";



    ScanaStudio.builder_add_samples(ch_clk,0,sample_per_clock/2);
    swd_builder.put_silence(samples_to_build/100);

    // Reset Sequence
    swd_builder.put_bit(0);
    for (i=0; i<51; i++)
    {
        swd_builder.put_bit(1);
    }
    // Idle cycles
    swd_builder.put_bit(0);
    swd_builder.put_bit(0);
    swd_builder.put_bit(0);
    swd_builder.put_bit(0);

    if (Protocol_version == SWD_PROTOCOL_VERSION_2)
    {
        // Request DP TARGETSEL
        swd_builder.put_start();
        swd_builder.put_request("DP", "Write", 3, parity_array); // Write on TARGETSEL
        swd_builder.put_parity_bit(parity_array);
        swd_builder.put_stop();
        swd_builder.put_park();
        swd_builder.put_trn();

        // ACK
        swd_builder.put_ack(1); // Equivalent to "OK"
        if (RnW == "Write")
        {
            swd_builder.put_trn();
        }

        // DATA
        parity_array = [];
        swd_builder.put_data_bits(1,1, parity_array); //RAO
        swd_builder.put_data_bits(1967994021,31, parity_array); //RES0
        swd_builder.put_parity_bit(parity_array);
        if (RnW == "Read")
        {
            swd_builder.put_trn();
        }
    }

    swd_builder.put_bit(0);
    swd_builder.put_bit(0);
    swd_builder.put_bit(0);
    // Request DP DPIDR
    parity_array = [];
    swd_builder.put_start();
    swd_builder.put_request("DP", "Read", 0, parity_array); // Write on DPIDR
    swd_builder.put_parity_bit(parity_array);
    swd_builder.put_stop();
    swd_builder.put_park();
    swd_builder.put_trn();

    // ACK
    swd_builder.put_ack("OK");
    if (RnW == "Write")
    {
        swd_builder.put_trn();
    }

    // DATA
    parity_array = [];
    swd_builder.put_data_bits(1,1, parity_array); //RAO
    swd_builder.put_rand_data(16, parity_array); // rng
    swd_builder.put_data_bits(0,3, parity_array); //RES0
    swd_builder.put_rand_data(12, parity_array); // rng
    swd_builder.put_parity_bit(parity_array);
    if (RnW == "Read")
    {
        swd_builder.put_trn();
    }

    // Request SELECT
    parity_array = [];
    swd_builder.put_start();
    swd_builder.put_request("DP", "Write", 2, parity_array); // Write on SELECT
    swd_builder.put_parity_bit(parity_array);
    swd_builder.put_stop();
    swd_builder.put_park();
    swd_builder.put_trn();

    // ACK
    swd_builder.put_ack("OK");
    if (RnW == "Write")
    {
        swd_builder.put_trn();
    }

    // DATA
    parity_array = [];
    swd_builder.put_data_bits(1,1, parity_array);
    swd_builder.put_rand_data(31, parity_array);
    DP_BANK_SEL = 0;
    for (i=0; i<4; i++)
    {
        DP_BANK_SEL += parity_array[i] * Math.pow(2,i);
    }
    swd_builder.put_parity_bit(parity_array);

    if (RnW == "Read")
    {
        swd_builder.put_trn();
    }

    // Idle cycles
    swd_builder.put_bit(0);
    swd_builder.put_bit(0);
    swd_builder.put_bit(0);
    swd_builder.put_bit(0);


    // Request
    parity_array = [];
    swd_builder.put_start();
    swd_builder.put_request("DP", "Write", 2, parity_array); // Write on SELECT
    swd_builder.put_parity_bit(parity_array);
    swd_builder.put_bit(1); // It's to generate an error and check if the decoder is able to detect it and try to find the reset line below
    swd_builder.put_park();


    swd_builder.put_rand_data(6, parity_array);
    // Request DP DPIDR
    swd_builder.put_bit(1);
    swd_builder.put_bit(1);
    parity_array = [];
    swd_builder.put_start();
    swd_builder.put_request("DP", "Read", 0, parity_array); // Read on DPIDR
    swd_builder.put_parity_bit(parity_array);
    swd_builder.put_stop();
    swd_builder.put_park();
    swd_builder.put_trn();

    // ACK
    swd_builder.put_ack("OK");
    if (RnW == "Write")
    {
        swd_builder.put_trn();
    }

    // DATA
    parity_array = [];
    swd_builder.put_data_bits(1,1, parity_array); //RAO
    swd_builder.put_rand_data(16, parity_array); // rng
    swd_builder.put_data_bits(0,3, parity_array); //RES0
    swd_builder.put_rand_data(12, parity_array); // rng
    swd_builder.put_parity_bit(parity_array);
    if (RnW == "Read")
    {
        swd_builder.put_trn();
    }

    // Request
    parity_array = [];
    swd_builder.put_start();
    swd_builder.put_request("DP", "Read", 0, parity_array); // Read on DPIDR
    swd_builder.put_parity_bit(parity_array);
    swd_builder.put_stop();
    swd_builder.put_park();
    swd_builder.put_trn();

    // ACK
    swd_builder.put_ack("WAIT");
    swd_builder.put_trn();

    // Reset Sequence
    swd_builder.put_bit(0);
    for (i=0; i<50; i++)
    {
        swd_builder.put_bit(1);
    }
    // Idle cycles
    swd_builder.put_bit(0);
    swd_builder.put_bit(0);
    swd_builder.put_bit(0);
    swd_builder.put_bit(0);
    DP_BANK_SEL = 0;


    // Request DP DPIDR
    parity_array = [];
    swd_builder.put_start();
    swd_builder.put_request("DP", "Read", 0, parity_array); // Read on DPIDR
    swd_builder.put_parity_bit(parity_array);
    swd_builder.put_stop();
    swd_builder.put_park();
    swd_builder.put_trn();

    // ACK
    swd_builder.put_ack("OK");
    if (RnW == "Write")
    {
        swd_builder.put_trn();
    }

    // DATA
    parity_array = [];
    swd_builder.put_data_bits(1,1, parity_array); //RAO
    swd_builder.put_rand_data(16, parity_array); // rng
    swd_builder.put_data_bits(0,3, parity_array); //RES0
    swd_builder.put_rand_data(12, parity_array); // rng
    swd_builder.put_parity_bit(parity_array);
    if (RnW == "Read")
    {
        swd_builder.put_trn();
    }

    // Request DP SELECT
    // Idle cycles
    for (i=0; i<4; i++)
    {
        swd_builder.put_bit(0);
    }
    parity_array = [];
    swd_builder.put_start();
    swd_builder.put_request("DP", "Write", 2, parity_array); // Write on SELECT
    swd_builder.put_parity_bit(parity_array);
    swd_builder.put_stop();
    swd_builder.put_park();
    swd_builder.put_trn();

    // ACK
    swd_builder.put_ack("OK");
    if (RnW == "Write")
    {
        swd_builder.put_trn();
    }

    // DATA
    parity_array = [];
    swd_builder.put_rand_data(4, parity_array); // rng
    swd_builder.put_data_bits(251,28, parity_array); //RAO
    AP_Adress = 251;
    DP_BANK_SEL = 0;
    for (i=0; i<4; i++)
    {
        DP_BANK_SEL += parity_array[i] * Math.pow(2,i);
    }
    swd_builder.put_parity_bit(parity_array);
    if (RnW == "Read")
    {
        swd_builder.put_trn();
    }

    // Request AP Read
    // Idle cycles
    for (i=0; i<8; i++)
    {
        swd_builder.put_bit(0);
    }
    parity_array = [];
    swd_builder.put_start();
    swd_builder.put_request("AP", "Read", 2, parity_array); // Read on TAR
    swd_builder.put_parity_bit(parity_array);
    swd_builder.put_stop();
    swd_builder.put_park();
    swd_builder.put_trn();

    // ACK
    swd_builder.put_ack("OK");
    if (RnW == "Write")
    {
        swd_builder.put_trn();
    }

    // DATA
    parity_array = [];
    swd_builder.put_rand_data(4, parity_array); // rng
    swd_builder.put_data_bits(208,28, parity_array); //RAO
    swd_builder.put_parity_bit(parity_array);
    if (RnW == "Read")
    {
        swd_builder.put_trn();
    }

    // Request AP Read
    // Idle cycles
    for (i=0; i<8; i++)
    {
        swd_builder.put_bit(0);
    }
    parity_array = [];
    swd_builder.put_start();
    swd_builder.put_request("AP", "Read", 0, parity_array); // Read on CSW
    swd_builder.put_parity_bit(parity_array);
    swd_builder.put_stop();
    swd_builder.put_park();
    swd_builder.put_trn();

    // ACK
    swd_builder.put_ack("OK");
    if (RnW == "Write")
    {
        swd_builder.put_trn();
    }

    // DATA
    parity_array = [];
    swd_builder.put_rand_data(4, parity_array); // rng
    swd_builder.put_data_bits(208,28, parity_array); //RAO
    swd_builder.put_parity_bit(parity_array);
    if (RnW == "Read")
    {
        swd_builder.put_trn();
    }

    // Request AP Read
    // Idle cycles
    for (i=0; i<8; i++)
    {
        swd_builder.put_bit(0);
    }
    parity_array = [];
    swd_builder.put_start();
    swd_builder.put_request("AP", "Read", 1, parity_array); // Read on TAR
    swd_builder.put_parity_bit(parity_array);
    swd_builder.put_stop();
    swd_builder.put_park();
    swd_builder.put_trn();

    // ACK
    swd_builder.put_ack("OK");
    if (RnW == "Write")
    {
        swd_builder.put_trn();
    }

    // DATA
    parity_array = [];
    swd_builder.put_rand_data(4, parity_array); // rng
    swd_builder.put_data_bits(208,28, parity_array); //RAO
    swd_builder.put_parity_bit(parity_array);
    if (RnW == "Read")
    {
        swd_builder.put_trn();
    }

    // Request AP Read
    // Idle cycles
    for (i=0; i<8; i++)
    {
        swd_builder.put_bit(0);
    }
    parity_array = [];
    swd_builder.put_start();
    swd_builder.put_request("AP", "Read", 3, parity_array); // Read on DEVARCH
    swd_builder.put_parity_bit(parity_array);
    swd_builder.put_stop();
    swd_builder.put_park();
    swd_builder.put_trn();

    // ACK
    swd_builder.put_ack("OK");
    if (RnW == "Write")
    {
        swd_builder.put_trn();
    }

    // DATA
    parity_array = [];
    swd_builder.put_rand_data(4, parity_array); // rng
    swd_builder.put_data_bits(208,28, parity_array); //RAO
    swd_builder.put_parity_bit(parity_array);
    if (RnW == "Read")
    {
        swd_builder.put_trn();
    }

    // Request REDBUFF
    // Idle cycles
    for (i=0; i<8; i++)
    {
        swd_builder.put_bit(0);
    }
    parity_array = [];
    swd_builder.put_start();
    swd_builder.put_request("DP", "Read", 3, parity_array); // Read on RDBUFF
    swd_builder.put_parity_bit(parity_array);
    swd_builder.put_stop();
    swd_builder.put_park();
    swd_builder.put_trn();

    // ACK
    swd_builder.put_ack("OK");
    if (RnW == "Write")
    {
        swd_builder.put_trn();
    }

    // DATA
    parity_array = [];
    swd_builder.put_rand_data(4, parity_array); // rng
    swd_builder.put_data_bits(208,28, parity_array); //RAO
    swd_builder.put_parity_bit(parity_array);
    if (RnW == "Read")
    {
        swd_builder.put_trn();
    }

    // Request REDBUFF
    // Idle cycles
    for (i=0; i<8; i++)
    {
        swd_builder.put_bit(0);
    }
    parity_array = [];
    swd_builder.put_start();
    swd_builder.put_request("DP", "Read", 3, parity_array); // Read on RDBUFF
    swd_builder.put_parity_bit(parity_array);
    swd_builder.put_stop();
    swd_builder.put_park();
    swd_builder.put_trn();

    // ACK
    swd_builder.put_ack("OK");
    if (RnW == "Write")
    {
        swd_builder.put_trn();
    }

    // DATA
    parity_array = [];
    swd_builder.put_rand_data(4, parity_array); // rng
    swd_builder.put_data_bits(208,28, parity_array); //RAO
    swd_builder.put_parity_bit(parity_array);
    if (RnW == "Read")
    {
        swd_builder.put_trn();
    }

    // Request RESEND
    // Idle cycles
    for (i=0; i<8; i++)
    {
        swd_builder.put_bit(0);
    }
    parity_array = [];
    swd_builder.put_start();
    swd_builder.put_request("DP", "Read", 2, parity_array); // Read on RESEND
    swd_builder.put_parity_bit(parity_array);
    swd_builder.put_stop();
    swd_builder.put_park();
    swd_builder.put_trn();

    // ACK
    swd_builder.put_ack("OK");
    if (RnW == "Write")
    {
        swd_builder.put_trn();
    }

    // DATA
    parity_array = [];
    swd_builder.put_rand_data(4, parity_array); // rng
    swd_builder.put_data_bits(208,28, parity_array); //RAO
    swd_builder.put_parity_bit(parity_array);
    if (RnW == "Read")
    {
        swd_builder.put_trn();
    }


    while(ScanaStudio.builder_get_samples_acc(io_channel) < samples_to_build )
    {
        var rng_reset = Math.floor(Math.random()*1.01);
        if (rng_reset == 1)
        {
            // Idle cycles
            for (i=0; i<8; i++)
            {
                swd_builder.put_bit(0);
            }
            // Reset Sequence
            for (i=0; i<50; i++)
            {
                swd_builder.put_bit(1);
            }
            // Idle cycles
            swd_builder.put_bit(0);
            swd_builder.put_bit(0);
            swd_builder.put_bit(0);
            swd_builder.put_bit(0);
            DP_BANK_SEL = 0;
            Turnaround_period = 1;

            // Request DP DPIDR
            parity_array = [];
            swd_builder.put_start();
            swd_builder.put_request("DP", "Read", 0, parity_array); // Read on DPIDR
            swd_builder.put_parity_bit(parity_array);
            swd_builder.put_stop();
            swd_builder.put_park();
            swd_builder.put_trn();

            // ACK
            swd_builder.put_ack("OK");
            if (RnW == "Write")
            {
                swd_builder.put_trn();
            }

            // DATA
            parity_array = [];
            swd_builder.put_data_bits(1,1, parity_array); //RAO
            swd_builder.put_rand_data(16, parity_array); // rng
            swd_builder.put_data_bits(0,3, parity_array); //RES0
            swd_builder.put_rand_data(12, parity_array); // rng
            swd_builder.put_parity_bit(parity_array);
            if (RnW == "Read")
            {
                swd_builder.put_trn();
            }
        }
        else
        {
            // Request
            var rng_idle = Math.floor(Math.random()*1.1);
            if (rng_idle == 1)
            {
                for (i=0; i<10; i++)
                {
                    swd_builder.put_bit(0);
                }
            }
            parity_array = [];
            swd_builder.put_start();
            swd_builder.put_rand_request(parity_array);
            get_register_name(RnW, Adress*4, APnDP, DP_BANK_SEL);
            swd_builder.put_parity_bit(parity_array);
            swd_builder.put_stop();
            swd_builder.put_park();
            swd_builder.put_trn();

            swd_builder.put_ack("OK");
            if (RnW == "Write")
            {
                swd_builder.put_trn();
            }

            parity_array = [];
            switch (Register_name)
            {
                case "SELECT" :
                {
                    rng_data = 0;
                    while (rng_data != 208 && rng_data != 209 && rng_data != 210 && rng_data != 211 && rng_data != 223 && rng_data != 240 && rng_data != 250 && rng_data != 251 && rng_data != 252 && rng_data != 253 && rng_data != 254 && rng_data != 255)
                    {
                        rng_data = 208 + Math.floor(Math.random()*48);
                    }
                    rng_dp_bank_sel = Math.floor(Math.random()*6.9);
                    swd_builder.put_data_bits(rng_dp_bank_sel, 4, parity_array);
                    swd_builder.put_data_bits(rng_data, 28, parity_array);
                    SELECT_ADDR = rng_data;
                    update_AP_adress();
                    DP_BANK_SEL = rng_dp_bank_sel;
                    break;
                }
                case "SELECT1" :
                {
                    // rng_data = 208 + Math.floor(Math.random()*48);
                    rng_data = 0;
                    swd_builder.put_data_bits(rng_data, 32, parity_array);
                    SELECT1_ADDR = rng_data;
                    update_AP_adress();
                    break;
                }
                case "DLCR" :
                {
                    swd_builder.put_rand_data(32, parity_array);
                    Turnaround_period = parity_array[8];
                    Turnaround_period += parity_array[9]*2 + 1;
                    break;
                }
                case "Reserved, RES0" :
                {
                    rng = Math.floor(Math.random()*1.1);
                    if (rng == 0)
                    {
                        swd_builder.put_data_bits(0, 32, parity_array);
                    }
                    else
                    {
                        swd_builder.put_rand_data(32, parity_array);
                    }
                    break;
                }
                default :
                {
                    swd_builder.put_data_bits(1,1, parity_array);
                    swd_builder.put_rand_data(31, parity_array);
                    break;
                }
            }
            swd_builder.put_parity_bit(parity_array);
            if (RnW == "Read")
            {
                swd_builder.put_trn();
            }
        }
    }



}

//Builder object that can be shared to other scripts
ScanaStudio.BuilderObject =
{
    put_bit : function(lvl)
    {
            ScanaStudio.builder_add_samples(this.ch_io,lvl,this.samples_per_clock);
            if (clk_lvl == 1)
            {
                ScanaStudio.builder_add_samples(this.ch_clk,0,this.half_samples_per_clock);
                ScanaStudio.builder_add_samples(this.ch_clk,1,this.samples_per_clock - this.half_samples_per_clock);
                clk_lvl = 1;
            }
            else
            {
                ScanaStudio.builder_add_samples(this.ch_clk,1,this.half_samples_per_clock);
                ScanaStudio.builder_add_samples(this.ch_clk,0,this.samples_per_clock - this.half_samples_per_clock);
                clk_lvl = 0;
            }
    },

    put_half_bit : function(lvl)
    {
            if (clk_lvl == 1)
            {
                clk_lvl = 0;
            }
            else
            {
                clk_lvl = 1;
            }
            ScanaStudio.builder_add_samples(this.ch_io,lvl,this.half_samples_per_clock);
            ScanaStudio.builder_add_samples(this.ch_clk,clk_lvl,this.half_samples_per_clock);
    },

    put_start : function()
    {
        this.put_bit(1);
    },

    put_stop : function()
    {
        this.put_bit(0);
    },

    put_request : function(APnDP_bit, RnW_bit, Adress_value, array)
    {
        // You can input string as "AP" or "DP" or Numbers 1 or 0 to define APnDP bit
        if (APnDP_bit == "AP")
        {
            APnDP_bit = 1;
        }
        else if (APnDP_bit == "DP")
        {
            APnDP_bit = 0;
        }
        this.put_bit(APnDP_bit);
        array.push(APnDP_bit);
        // You can input string as "Read" or "Write" or Numbers 1 or 0 to define RnW bit
        if (RnW_bit == "Read")
        {
            RnW_bit = 1;
        }
        else if (RnW_bit == "Write")
        {
            RnW_bit = 0;
        }
        this.put_bit(RnW_bit);
        array.push(RnW_bit);
        for (n=0; n<2; n++)
        {
            this.put_bit(((Adress_value>>n)&0x1));
            array.push(((Adress_value>>n)&0x1));
        }
        Adress = Adress_value;
        if (RnW_bit == 1)
        {
            RnW = "Read";
        }
        else if (RnW_bit == 0)
        {
            RnW = "Write";
        }
    },

    put_rand_request : function(array)
    {
        for (n = 0; n < 4; n++)
        {
            var lvl = Math.floor(Math.random()*2);
            this.put_bit(lvl);
            array.push(lvl);
            if (n == 0) // APnDP
            {
                if (lvl == 1)
                {
                    APnDP = "AP";
                }
                else
                {
                    APnDP = "DP";
                }
            }
            if (n == 1) // RnW
            {
                if (lvl == 1)
                {
                    RnW = "Read";
                }
                else
                {
                    RnW = "Write";
                }
            }
            if (n == 2) // Adress
            {
                if (lvl == 1)
                {
                    Adress = 1;
                }
                else
                {
                    Adress = 0;
                }
            }
            if (n == 3)
            {
                if (lvl == 1)
                {
                    Adress += 2;
                }
                else
                {
                    Adress += 0;
                }
            }
        }
    },

    put_data_bits : function(value, nbits, array)
    {
        for (n=0; n<nbits; n++)
        {
            this.put_bit(((value>>n)&0x1));
            array.push(((value>>n)&0x1));
        }
    },

    put_rand_data : function(nbits, array)
    {
        for (n = 0; n < nbits; n++)
        {
            var lvl = Math.floor(Math.random()*2);
            this.put_bit(lvl);
            array.push(lvl);
        }
    },

    put_ack : function(response) // Response can be the equivalent value in decimal or a string like "OK", "WAIT" or "FAULT"
    {
        if ((typeof (response)) == "string")
        {
            switch (response)
            {
                case "OK" :
                case 1 :
                {
                    this.put_bit(1);
                    this.put_bit(0);
                    this.put_bit(0);
                    break;
                }
                case "WAIT" :
                case 2 :
                {
                    this.put_bit(0);
                    this.put_bit(1);
                    this.put_bit(0);
                    break;
                }
                case "FAULT" :
                case 4 :
                {
                    this.put_bit(0);
                    this.put_bit(0);
                    this.put_bit(1);
                    break;
                }
                default :
                {
                    this.put_bit(1);
                    this.put_bit(1);
                    this.put_bit(1);
                    break;
                }
            }
        }
        else
        {
            for (n=0; n<3; n++)
            {
                var n_value = (response>>n)&0x1;
                this.put_bit(n_value);
            }
        }
    },

    put_rand_ack : function()
    {
        for (i=0; i<3; i++)
        {
            var lvl = Math.floor(Math.random()*2);
            this.put_bit(lvl);
        }
    },


    put_silence : function(s)
    {
        for(i=0; i<s/this.samples_per_clock; i++)
        {
            this.put_bit(0);
        }
    },

    put_trn : function ()
    {
        var j = 1;
        while (j<Turnaround_period)
        {
            this.put_bit(1);
            j++;
        }
        this.put_half_bit(1);
        if (second_trn == true)
        {
            this.put_bit(1);
            second_trn = false;
        }
        else
        {
            second_trn = true;
        }
    },

    put_park : function()
    {
        this.put_bit(1);
    },

    put_parity_bit : function(parity_array)
    {
        var nb_high_bit = 0;
        for (i=0; i<parity_array.length; i++)
        {
            nb_high_bit += parity_array[i];
        }
        if (nb_high_bit%2 == 1)
        {
            parity_value = 1;
        }
        else
        {
            parity_value = 0;
        }
        this.put_bit(parity_value);
    },


    config : function(ch_io,ch_clk,frequency)
    {
        this.ch_io = ch_io;
        this.ch_clk = ch_clk;
        this.half_samples_per_clock = Math.floor(ScanaStudio.builder_get_sample_rate() / (2*frequency));
        this.samples_per_clock = 2*this.half_samples_per_clock ;
    },

};//end BuilderObject


function update_AP_adress()
{
    AP_Adress = SELECT_ADDR;
    if (SELECT1_ADDR > 0)
    {
        SELECT_string_hexa = "0x" + pad(SELECT1_ADDR.toString(16),8) + pad(SELECT_ADDR.toString(16),7);
    }
    else
    {
        SELECT_string_hexa = "";
    }
}

function get_register_name(RnW, Adress, APnDP, DP_BANK_SEL)
{
    if(APnDP == "DP") //DP Register
    {
        switch(Adress)
        {
            case 0 : //0x0
            {
                if (RnW == "Read")
                {
                    switch (DP_BANK_SEL)
                    {
                        case 0 :
                        {
                            Register_name = "DPIDR";
                            break;
                        }
                        case 1 :
                        {
                            Register_name = "DPIDR1";
                            break;
                        }
                        case 2 :
                        {
                            Register_name = "BASEPTR0";
                            break;
                        }
                        case 3 :
                        {
                            Register_name = "BASEPTR1";
                            break;
                        }
                        default :
                        {
                            Register_name = "Reserved, RES0";
                            break;
                        }
                    }
                }
                else
                {
                    Register_name = "ABORT";
                    break;
                }
                break;
            }//end case 0

            case 4 : //0x4
            {
                switch (DP_BANK_SEL)
                {
                    case 0 :
                    {
                        Register_name = "CTRL/STAT";
                        break;
                    }
                    case 1 :
                    {
                        Register_name = "DLCR";
                        break;
                    }
                    case 2 :
                    {
                        if (RnW == "Read")
                        {
                            Register_name = "TARGETID";
                        }
                        else
                        {
                            Register_name = "RO Register"; //RO = Read Only
                        }
                        break;
                    }
                    case 3 :
                    {
                        if (RnW == "Read")
                        {
                            Register_name = "DLPIDR";
                        }
                        else
                        {
                            Register_name = "RO Register"; //RO = Read Only
                        }
                        break;
                    }
                    case 4 :
                    {
                        if (RnW == "Read")
                        {
                            Register_name = "EVENTSTAT";
                        }
                        else
                        {
                            Register_name = "RO Register"; //RO = Read Only
                        }
                        break;
                    }
                    case 5 :
                    {
                        if (RnW == "Read")
                        {
                            Register_name = "SELECT1";
                        }
                        else
                        {
                            Register_name = "RO Register"; //RO = Read Only
                        }
                        break;
                    }
                    default :
                    {
                        Register_name = "Reserved, RES0";
                        break;
                    }
                }
                break;
            }//end case 4

            case 8 : //0x8
            {
                if (RnW == "Write")
                {
                    Register_name = "SELECT";
                }
                else
                {
                    Register_name = "RESEND";
                }
                break;
            }//end case 8

            case 12 : //0xC
            {
                if (RnW == "Read")
                {
                    Register_name = "RDBUFF";
                }
                else if ((RnW == "Write") && (Protocol_version == SWD_PROTOCOL_VERSION_2))
                {
                    Register_name = "TARGETSEL"; // if SWD protocol version 2 is implemented
                }
                else
                {
                    Register_name = "Reserved, RES0";
                }
                break;
            }//end case 12
        }//end switch (Address)
    }//end if (APnP == "DP")
    else //AP Register
    {
        if (AP_Memory == "MEM-AP")
        {
            if ((AP_Adress >=0) && (AP_Adress <= 63))
            {
                Register_name = "DAR";
            }
            switch (AP_Adress) // Combination of SELECT.ADDR and SELECT1.ADDR (60-bit address)
            {
                case 208 : //0xD0
                {
                    switch (Adress)
                    {
                        case 0 :
                        {
                            Register_name = "CSW";
                            break;
                        }
                        case 4 :
                        case 8 :
                        {
                            Register_name = "TAR";
                            break;
                        }
                        case 12 :
                        {
                            Register_name = "DRW";
                            break;
                        }
                    }
                    break;
                }

                case 209 : //0xD1
                {
                    Register_name = "BD";
                    break;
                }

                case 210 : //0xD2
                {
                    switch (Adress)
                    {
                        case 0 :
                        {
                            Register_name = "MBT";
                            break;
                        }
                        case 4 :
                        {
                            Register_name = "TRR";
                            break;
                        }
                        default :
                        {
                            Register_name = "Reserved, RES0";
                            break;
                        }
                    }
                    break;
                }

                case 211 : //0xD2
                {
                    switch (Adress)
                    {
                        case 0 :
                        {
                            Register_name = "MBT";
                            break;
                        }
                        case 4 :
                        {
                            Register_name = "TRR";
                            break;
                        }
                        default :
                        {
                            Register_name = "Reserved, RES0";
                            break;
                        }
                    }
                    break;
                }

                case 223 : //0xDF
                {
                    if (RnW == "Read")
                    {
                        switch (Adress)
                        {
                            case 0 :
                            case 8 :
                            {
                                Register_name = "BASE";
                                break;
                            }
                            case 4 :
                            {
                                Register_name = "CFG";
                                break;
                            }
                            case 12 :
                            {
                                Register_name = "IDR";
                                break;
                            }
                        }
                    }
                    else
                    {
                        Register_name = "RO Register";
                    }
                    break;
                }


                default :
                {
                    Register_name = "Reserved, RES0";
                    break;
                }
            }//end switch (AP_Adress)
        }//end if (AP_Register == "MEM-AP")
        else if (AP_Register == "JTAG-AP")// else AP_Register == "JTAG-AP"
        {
            switch (AP_Adress)
            {
                case 208 : //0xD0
                {
                    switch (Adress)
                    {
                        case 0 : // 0x0
                        {
                            Register_name = "CSW";
                            break;
                        }
                        case 4 : // 0x4
                        {
                            Register_name = "PSEL";
                            break;
                        }
                        case 8 : // 0x8
                        {
                            Register_name = "PSTA";
                            break;
                        }
                        case 12 : // 0xC
                        {
                            Register_name = "Reserved, RES0";
                            break;
                        }
                    }
                }
                case 209 : //0xD1
                {
                    Register_name = "BRFIFO";
                    break;
                }
                case 223 : //0xDF
                {
                    Register_name = "IDR";
                    break;
                }
                default :
                {
                    Register_name = "Reserved, RES0";
                    break;
                }
            }
        }//end else if(AP_Register == "JTAG-AP")
        else // If it's another AP than MEM-AP or JTAG-AP
        {
            Register_name = "Unknown AP";
        }
        switch (AP_Adress)
        {
            case 240 : //0xF0
            {
                switch (Adress)
                {
                    case 0 :
                    {
                        Register_name = "ITCTRL";
                        break;
                    }
                    default :
                    {
                        Register_name = "Reserved, RES0";
                        break;
                    }
                }
                break;
            }
            case 250 : //0xFA
            {
                switch (Adress)
                {
                    case 0 :
                    {
                        Register_name = "CLAIMSET";
                        break;
                    }
                    case 4 :
                    {
                        Register_name = "CLAIMCLR";
                        break;
                    }
                    case 8 :
                    case 12 :
                    {
                        if (RnW == "Read")
                        {
                            Register_name = "DEVAFF";
                        }
                        else
                        {
                            Register_name = "RO Register"
                        }
                        break;
                    }
                }
                break;
            }
            case 251 : //0xFB
            {
                switch (Adress)
                {
                    case 0 :
                    {
                        if (RnW == "Write")
                        {
                            Register_name = "LAR";
                        }
                        else
                        {
                            Register_name = "WO Register" //Write only
                        }
                        break;
                    }
                    case 4 :
                    {
                        if (RnW == "Read")
                        {
                            Register_name = "LSR";
                        }
                        else
                        {
                            Register_name = "RO Register"
                        }
                        break;
                    }
                    case 8 :
                    {
                        if (RnW == "Read")
                        {
                            Register_name = "AUTHSTATUS";
                        }
                        else
                        {
                            Register_name = "RO Register"
                        }
                        break;
                    }
                    case 12 :
                    {
                        if (RnW == "Read")
                        {
                            Register_name = "DEVARCH";
                        }
                        else
                        {
                            Register_name = "RO Register"
                        }
                        break;
                    }
                }
                break;
            }
            case 252 : //0xFC
            {
                if (RnW == "Read")
                {
                    switch (Adress)
                    {
                        case 0 :
                        case 4 :
                        case 8 :
                        {
                            Register_name = "DEVID";
                            break;
                        }
                        case 12 :
                        {
                            Register_name = "DEVTYPE";
                            break;
                        }
                    }
                }
                else
                {
                    Register_name = "RO Register";
                }
                break;
            }
            case 253 : //0xFD
            case 254 : //0xFE
            {
                if (RnW == "Read")
                {
                    Register_name = "PIDR";
                }
                else
                {
                    Register_name = "RO Register"
                }
                break;
            }
            case 255 : //0xFF
            {
                if (RnW == "Read")
                {
                    Register_name = "CIDR";
                }
                else
                {
                    Register_name = "RO Register"
                }
                break;
            }
        }
    }//end else (APnP == "AP")

    if (SELECT_string_hexa != "")
    {
        Register_name = SELECT_string_hexa;
    }
}//end function get_register_name

function display_register_name()
{
    switch (Register_name)
    {
        case "PIDR" :
        {
            if (AP_Adress == 254)
            {
                var number = Adress/4;
                ScanaStudio.dec_item_add_content("Adress field : 0x" + pad(Adress.toString(16),1) + " or Register '" + Register_name + number + "'");
                packet_string = "0x" + pad(Adress.toString(16),1) + " or Register '" + Register_name + number + "'";
            }
            else
            {
                var number = Adress/4 + 4;
                ScanaStudio.dec_item_add_content("Adress field : 0x" + pad(Adress.toString(16),1) + " or Register '" + Register_name + number + "'");
                packet_string = "0x" + pad(Adress.toString(16),1) + " or Register '" + Register_name + number + "'";
            }
            break;
        }
        case "DEVAFF" :
        {
            var number = Adress/4 - 2;
            ScanaStudio.dec_item_add_content("Adress field : 0x" + pad(Adress.toString(16),1) + " or Register '" + Register_name + number + "'");
            packet_string = "0x" + pad(Adress.toString(16),1) + " or Register '" + Register_name + number + "'";
            break;
        }
        case "CIDR" :
        case "BD" :
        {
            var number = Adress/4;
            ScanaStudio.dec_item_add_content("Adress field : 0x" + pad(Adress.toString(16),1) + " or Register '" + Register_name + number + "'");
            packet_string = "0x" + pad(Adress.toString(16),1) + " or Register '" + Register_name + number + "'";
            break;
        }
        case "DAR" :
        {
            var number = AP_Adress*4 + Adress/4;
            ScanaStudio.dec_item_add_content("Adress field : 0x" + pad(Adress.toString(16),1) + " or Register '" + Register_name + number + "'");
            packet_string = "0x" + pad(Adress.toString(16),1) + " or Register '" + Register_name + number + "'";
            break;
        }
        case "BRFIFO" :
        case "BWFIFO" :
        {
            var number = Adress/4 + 1;
            ScanaStudio.dec_item_add_content("Adress field : 0x" + pad(Adress.toString(16),1) + " or Register '" + Register_name + number + "'");
            packet_string = "0x" + pad(Adress.toString(16),1) + " or Register '" + Register_name + number + "'";
            break;
        }
        case "DEVID" :
        {
            var number = 2 - Adress/4 ;
            ScanaStudio.dec_item_add_content("Adress field : 0x" + pad(Adress.toString(16),1) + " or Register '" + Register_name + number + "'");
            packet_string = "0x" + pad(Adress.toString(16),1) + " or Register '" + Register_name + number + "'";
            break;
        }
        default :
        {
            ScanaStudio.dec_item_add_content("Adress field : 0x" + pad(Adress.toString(16),1) + " or Register '" + Register_name + "'");
            packet_string = "0x" + pad(Adress.toString(16),1) + " or Register '" + Register_name + "'";
            break;
        }
    }
}



/*  A helper function add leading "0"s to numbers
      Parameters
        * num_str: A string of the number to be 0-padded
        * size: The total wanted size of the output string
*/
function pad(num_str, size)
{
    while (num_str.length < size)
    {
        num_str = "0" + num_str;
    }
    return num_str;
}

function fill_TAR_Adress()
{
    var tab = [];
    tab = dec2bin(TAR_Adress_MSB);
    for (i=tab.length; i>=0; i--)
    {
        TAR_Adress.push(tab[i]);
    }
    tab = dec2bin(TAR_Adress_LSB);
    for (i=tab.length; i>=0; i--)
    {
        TAR_Adress.push(tab[i]);
    }
    TAR_string_hexa = "0x" + pad(TAR_Adress_MSB.toString(16),8) + pad(TAR_Adress_LSB.toString(16),8);
}

function RES0(start_sample, nbits, parity_array, Register_name)
{
    swd_simple = sync_decode_v2(io_channel,swd_simple.end_sample +1,nbits);
    if (last_trans == true) //if sync_decode overpassed the last sample
    {
        go_to_last_trans_io();
    }
    swd_value = Number(swd_simple.unsigned_words);
    item_display = parity_pre_calcul(swd_simple.unsigned_words, nbits, parity_array);
    dec_item_new_v2(ch_io,swd_simple);
    if (swd_value == 0)
    {
        types = "Misc";
    }
    else
    {
        types = "Error";
        ScanaStudio.dec_item_emphasize_error();
    }
    ScanaStudio.dec_item_add_content("RES0, a reserved bit or field with Should-Be-Zero-or-Preserved (SBZP) behavior");
    ScanaStudio.dec_item_add_content("RES0");
    display_sample(swd_simple);
    ScanaStudio.dec_item_end();
    //Packet View
    if (Register_name == "DEVID")
    {
        if (Adress == 0)
        {
            Register_name = "DEVID2";
        }
        else if (Adress == 4)
        {
            Register_name = "DEVID1";
        }
    }
    else if (Register_name == "DEVAFF")
    {
        if (Adress == 8)
        {
            Register_name = "DEVAFF0";
        }
        else if (Adress == 12)
        {
            Register_name = "DEVAFF1";
        }
    }
    else if (Register_name == "PIDR")
    {
        if (AP_Adress == 253)
        {
            switch (Adress)
            {
                case 0 :
                {
                    Register_name = "PIDR_4";
                    break;
                }
                case 4 :
                {
                    Register_name = "PIDR_5";
                    break;
                }
                case 8 :
                {
                    Register_name = "PIDR_6";
                    break;
                }
                case 12 :
                {
                    Register_name = "PIDR_7";
                    break;
                }
            }
        }
        else if (AP_Adress == 254)
        {
            switch (Adress)
            {
                case 0 :
                {
                    Register_name = "PIDR_0";
                    break;
                }
                case 4 :
                {
                    Register_name = "PIDR_1";
                    break;
                }
                case 8 :
                {
                    Register_name = "PIDR_2";
                    break;
                }
                case 12 :
                {
                    Register_name = "PIDR_3";
                    break;
                }
            }
        }
    }
    var Title = Register_name + ".RES0";
    packet_view_add_packet_v2(ch_io,swd_simple,Title,"RES0",types);
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
    if (driver == "Host")
    {
        var clock_polarity = 1;
    }
    else
    {
        var clock_polarity = 0;
    }
    for (b=0; (b < Math.floor(bits_per_word/32)) && (ScanaStudio.trs_is_not_last(ch_clk)); b++)
    {
        //ScanaStudio.sync_decode(clock_channel,data_channels,clock_start_sample,clock_polarity,msb_first,bits_per_word,bits_interleaving,clk_skip,word_end_sample)
        decoder_result_t = ScanaStudio.sync_decode(ch_clk,channel,current_start_sample,clock_polarity,false,32,false,0,-1);
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
    if (bits_per_word%32 != 0)
    {
        decoder_result_t = ScanaStudio.sync_decode(ch_clk,channel,current_start_sample,clock_polarity,false,bits_per_word%32,false,0,-1);
        if (decoder_result_t.valid_bits != bits_per_word%32)
        {
            last_trans = true;
        }
        pretab_1 = dec2bin(decoder_result_t.unsigned_words,bits_per_word%32);
        pretab_2 = dec2bin(decoder_result_t.signed_words,bits_per_word%32);
        for (k=0; k<pretab_1.length; k++)
        {
            tab_1.push(pretab_1[k]);
            tab_2.push(pretab_2[k]);
            sampling_point.push(decoder_result_t.start_sample + decoder_result_t.sampling_points[k] - decoder_result_t.sampling_points[0]);
        }
        valid_bit += decoder_result_t.valid_bits;
        }
        unsigned_words.push(bin2dec(tab_1));
        signed_words.push(bin2dec(tab_2));
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


// If Sync decode overpass the last sample, finish the decoding
function go_to_last_trans_io()
{
        while (ScanaStudio.trs_is_not_last(ch_io))
        {
            trs_io = ScanaStudio.trs_get_next(ch_io);
        }
}

// Push into bit_array the binary value of "value" (value is coded in nbits) (LSB)
function parity_pre_calcul(value, nbits, bit_array)
{
    tab = [];
    for (i=0; i < nbits; i++)
    {
        tab.push((Number(value)>>i)&0x1);
        bit_array.push(Number(((value)>>i)&0x1));
    }
    return tab;
}

//Return parity bit value from a bit array
function get_parity(bit_array)
{
    var parity_value = 0;
    var nb_high_bit = 0;
    for (i=0; i<bit_array.length; i++)
    {
        nb_high_bit += bit_array[i];
    }
    if (nb_high_bit%2 == 1)
    {
        parity_value = 1;
    }
    else
    {
        parity_value = 0;
    }
    return parity_value;
}

function dec_item_new_v2 (channel, swd_simple)
{
    var trs_start = ScanaStudio.trs_get_before(ch_clk,swd_simple.start_sample + 1);
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
    var trs_end = ScanaStudio.trs_get_before(ch_clk,swd_simple.end_sample + 1);
    var tmp_trs_sample_index;
    tmp_trs_sample_index = trs_end.sample_index;
    while( (tmp_trs_sample_index == trs_end.sample_index) && (ScanaStudio.trs_is_not_last(ch_clk) == true) )
    {
        trs_end = ScanaStudio.trs_get_next(ch_clk);
    }
    test = ScanaStudio.dec_item_new(channel,trs_start.sample_index ,trs_end.sample_index - 1);
    if (test != 1)
    {
        // ScanaStudio.console_info_msg("test : " + test);
    }
    return [trs_start.sample_index, trs_end.sample_index];
}

// Used for packet view, automately put the right Colors accordly to the types and change the data string item accordly to the GUI
function packet_view_add_packet_v2 (ch,swd_simple,title,content,types)
{
    switch (types)
    {
        case "Wrap" :
        {
            ScanaStudio.packet_view_add_packet(false,
                ch,
                swd_simple.start_sample,
                swd_simple.end_sample,
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
            swd_simple.start_sample,
            swd_simple.end_sample,
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
            swd_simple.start_sample,
            swd_simple.end_sample,
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
            swd_simple.start_sample,
            swd_simple.end_sample,
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
            swd_simple.start_sample,
            swd_simple.end_sample,
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
            swd_simple.start_sample,
            swd_simple.end_sample,
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
            swd_simple.start_sample,
            swd_simple.end_sample,
            title,
            content,
            ScanaStudio.PacketColors.Misc.Title,
            ScanaStudio.PacketColors.Misc.Content);
            break;
        }
    }
}

// Return an array of n bits
function dec2bin (data, nbits)
{
  var tab = [];
  var n = 0;
  var a = new Number(data);

  for (n = 0; n < nbits ; n++)
  {
      tab.push((parseInt(data)>>n)&0x1);
  }
  return tab;
}

// Return decimal value of nbits bits array
function bin2dec (array)
{
  var dec = 0;
  for (i = 0; i < array.length; i++)
  {
    dec += array[i]*Math.pow(2,i);
  }
  return dec;
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
