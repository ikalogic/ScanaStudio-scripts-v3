/* Protocol meta info:
<NAME> CAN Bus </NAME>
<DESCRIPTION>
CAN bus protocol analyzer
</DESCRIPTION>
<VERSION> 0.99 </VERSION>
<AUTHOR_NAME>  Ibrahim KAMAL, Nicolas Bastit </AUTHOR_NAME>
<AUTHOR_URL> i.kamal@ikalogic.com, n.bastit@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright Ibrahim KAMAL </COPYRIGHT>
<LICENSE>  This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
v0.99: Fix bug in trigger.
v0.98: Fix bug in trigger on CAN data bytes 0x00.
v0.97: Fix bug in trigger on CAN Data bytes.
v0.96: Added option to trigger on CAN Data bytes.
v0.95: Added trigger capability for normal and extended ID.
v0.9: Fix bug that caused error in decoding live streamed samples, fixed bug related to bit stuffing of CRC delimiter.
v0.8: Fix bug that caused bit stuffing in CRC field to be ignored.
v0.7: Fix bug that caused CAN FD frame with 0 data to have a wrong CRC.
v0.6: Fix several bugs related to bit stuffing errors.
V0.5: Added packet view
V0.3: Added dec_item_end() for each dec_item_new()
V0.2: Added error detection, added GUI validation, fixed bit stuffing errors
V0.1: Initial release
</RELEASE_NOTES>
*/

/*
// TODO in future releases
// documentation
// Add trigger support
*/

//Decoder GUI
function on_draw_gui_decoder()
{
  //Define decoder configuration GUI
  ScanaStudio.gui_add_ch_selector("ch","CAN Channel","CAN");
  ScanaStudio.gui_add_engineering_form_input_box("rate","Bit rate",100,1e6,125e3,"Bit/s");
  ScanaStudio.gui_add_new_tab("CAN FD options",false);
    ScanaStudio.gui_add_engineering_form_input_box("rate_fd","CAN-FD bit rate",100,20e6,2e6,"Bit/s");
    ScanaStudio.gui_add_info_label("If you're not using CAN-FD, you can just ignore this setting.");
  ScanaStudio.gui_end_tab();
  ScanaStudio.gui_add_new_tab("Display options",false);
    ScanaStudio.gui_add_combo_box("id_format","ID display format");
      ScanaStudio.gui_add_item_to_combo_box("HEX",true);
      ScanaStudio.gui_add_item_to_combo_box("Binary",false);
      ScanaStudio.gui_add_item_to_combo_box("Decimal",false);
    ScanaStudio.gui_add_combo_box("data_format","Data display format");
      ScanaStudio.gui_add_item_to_combo_box("HEX",true);
      ScanaStudio.gui_add_item_to_combo_box("Binary",false);
      ScanaStudio.gui_add_item_to_combo_box("Decimal",false);
    ScanaStudio.gui_add_combo_box("crc_format","CRC display format");
      ScanaStudio.gui_add_item_to_combo_box("HEX",true);
      ScanaStudio.gui_add_item_to_combo_box("Binary",false);
      ScanaStudio.gui_add_item_to_combo_box("Decimal",false);
  ScanaStudio.gui_end_tab();
}

//Evaluate decoder GUI
function on_eval_gui_decoder()
{
  sampling_rate = ScanaStudio.get_capture_sample_rate();
  var max_rate = sampling_rate/8; //We need at least that much points per bit period for correct decoding
  rate = ScanaStudio.gui_get_value("rate");
  rate_fd = ScanaStudio.gui_get_value("rate_fd");
  if (rate > max_rate)
  {
    return ("Selected bit rate of " + ScanaStudio.engineering_notation(rate,5) + "Hz"
            + " is too high compared to device sampling rate of " + ScanaStudio.engineering_notation(sampling_rate,5) + "Hz\n"
            + "(Maximum allowable bit rate is " + ScanaStudio.engineering_notation(max_rate,5) + "Hz"
          );
  }
  if (rate_fd > max_rate)
  {
    return ("Selected FD bit rate of " + ScanaStudio.engineering_notation(rate_fd,5) + "Hz"
            + " is too high compared to device sampling rate of " + ScanaStudio.engineering_notation(sampling_rate,5) + "Hz\n"
            + "(Maximum allowable bit rate is " + ScanaStudio.engineering_notation(max_rate,5) + "Hz"
          );
  }
  return "" //All good.
}

//Global variables
var sampling_rate;
var cursor,prev_cursor;
var state_machine;
var ch,rate,rate_fd;
var margin,margin_fd;
var stuff_mode = 0; //0: off, 1: std bit stuffing, 2: FD CRC bit stuffing
var samples_per_bit,samples_per_bit_std,samples_per_bit_fd,sample_point_offset;
var sample_point_offset_std,sample_point_offset_fd;
var fd_mode = false;
var bit_to_process,current_bit_value,dominant_bits_counter,same_bit_value_counter;
var switch_to_high_baud_rate = false;
var switch_to_std_baud_rate = false;
var crc_len = 15;
var dec_item_margin = 1;
var exit_while = false;
/*

Bit flow through the decoder:
[Samples]---->[bits]--┯----->[destuff]-------┯---->[process bits]
                      |                      |
                      └----->[CRC_FD calc]   └---->[CRC_STD calc]
*/


function on_decode_signals(resume)
{
  var is_stuffed_bit;
  var start_sample, end_sample;
  exit_while = false;

  if (!resume) //If resume == false, it's the first call to this function.
  {
      //initialization code goes here, ex:
      state_machine = 0;
      can_state_machine = CAN.SEEK_SOF;
      cursor = 1;
      sampling_rate = ScanaStudio.get_capture_sample_rate();
      ch = ScanaStudio.gui_get_value("ch");
      rate = ScanaStudio.gui_get_value("rate");
      rate_fd = ScanaStudio.gui_get_value("rate_fd");
      id_format = ScanaStudio.gui_get_value("id_format");
      data_format = ScanaStudio.gui_get_value("data_format");
      crc_format = ScanaStudio.gui_get_value("crc_format");
      samples_per_bit_std =  Math.floor(sampling_rate / rate);

      //Pinpoint exact sampling point (CAN Spec page 28)
      sample_point_offset_std = Math.floor(samples_per_bit_std *11 / 15);
      samples_per_bit_fd =  Math.floor(sampling_rate / rate_fd);
      samples_per_brs_bit = (samples_per_bit_std*11/15) + (samples_per_bit_fd*4/10);
      samples_per_fd_crc_del_bit = (samples_per_bit_fd*6/10) + (samples_per_bit_std*4/15);
      sample_point_offset_fd = Math.floor(samples_per_bit_fd *6 / 10);
      margin = Math.floor(samples_per_bit_std / 20) + 1;
      margin_fd = Math.floor(samples_per_bit_std / 20) + 1;
      fd_mode = false;
      stuff_mode = 1;
      current_bit_value = 0;
      dominant_bits_counter = 1;
      bit_to_process = 0;
      same_bit_value_counter = 0;
      crc_reset();
      ScanaStudio.trs_reset(ch);
  }

  while (ScanaStudio.abort_is_requested() == false)
  {
    if (!ScanaStudio.trs_is_not_last(ch))
    {
      break;
    }

    switch (state_machine)
    {
      case 0: //Search for next transition and sync to it.
        trs = ScanaStudio.trs_get_next(ch);
        if (trs.sample_index >= cursor)
        {
          cursor = trs.sample_index;
          if (fd_mode) //Flexible datarate CAN
          {
            samples_per_bit = samples_per_bit_fd;
            sample_point_offset = sample_point_offset_fd;
            ScanaStudio.bit_sampler_init(ch,cursor+sample_point_offset_fd,samples_per_bit);
            cursor += sample_point_offset_fd;
          }
          else  //standard CAN
          {
            samples_per_bit = samples_per_bit_std;
            sample_point_offset = sample_point_offset_std;
            ScanaStudio.bit_sampler_init(ch,cursor+sample_point_offset_std,samples_per_bit);
            cursor += sample_point_offset_std;
          }

          dec_item_margin = samples_per_bit / 8;
          current_bit_value = trs.value;
          prev_cursor = cursor;
          dominant_bits_counter = 0;
          same_bit_value_counter = 0;
          state_machine++;
        }
        break;
      case 1: //process bits until there is a change
        if (ScanaStudio.get_available_samples(ch) > (cursor + (samples_per_bit*2)))
        {
          bit_to_process = ScanaStudio.bit_sampler_next(ch)
          same_bit_value_counter++;
          if ((same_bit_value_counter > 6) && (can_state_machine < CAN.SEEK_CRC))
          {
            same_bit_value_counter = 0;
            cursor = prev_cursor;
            state_machine = 0;
            fd_mode = false;
            switch_to_high_baud_rate = false;
            switch_to_std_baud_rate = false;
            if (bit_to_process == 1)
            {
              can_state_machine = CAN.SEEK_SOF;
            }
            else
            {
                can_state_machine = CAN.SEEK_IDLE;
            }

            break;
          }

          if (can_state_machine == CAN.SEEK_IDLE)
          {
            stuffing_reset();
            stuff_mode = 1; //By default, normal stuffing
          }

          if (bit_to_process == current_bit_value)
          {
            is_stuffed_bit = false;
            if (stuff_mode == 1)
            {
              if (stuffing_check(bit_to_process) >= 0)
              {
                is_stuffed_bit = true;
              }
            }
            else if (stuff_mode == 2)
            {
              if (stuffing_check_fd_crc(bit_to_process) >= 0)
              {
                is_stuffed_bit = true;
              }
            }
            can_process_bit(bit_to_process,cursor,is_stuffed_bit);
            prev_cursor = cursor;

            if (switch_to_high_baud_rate && (is_stuffed_bit == false))
            {
              //scanastudio.console_info_msg("Switching to high baud rate here! new spb="+samples_per_bit_fd + ", was " + samples_per_bit_std,cursor);
              switch_to_high_baud_rate = false;
              ScanaStudio.bit_sampler_init(ch,cursor+samples_per_bit_fd,samples_per_bit_fd);
              cursor += samples_per_bit_fd;
              //scanastudio.console_info_msg("new cursor pos = " +  cursor,cursor);
              samples_per_bit = samples_per_bit_fd;
              fd_mode = true;
            }
            else if (switch_to_std_baud_rate && (is_stuffed_bit == false))
            {
              //scanastudio.console_info_msg("Switching to standard baud rate here!",cursor);
              switch_to_std_baud_rate = false;
              ScanaStudio.bit_sampler_init(ch,cursor+samples_per_bit_std,samples_per_bit_std);
              cursor += samples_per_bit_std;
              //scanastudio.console_info_msg("new cursor pos = " +  cursor,cursor);
              samples_per_bit = samples_per_bit_std;
              fd_mode = false;
            }
            else
            {
              cursor += samples_per_bit;
            }
          }
          else //CAN line level changed, resync!
          {
            cursor = prev_cursor;
            //ScanaStudio.console_info_msg("bit change at" + cursor,cursor);
            state_machine = 0;
          }
        }
        else
        {
          exit_while = true;
        }
        break;
      default:
        state_machine = 0;
    }

    if (exit_while)
    {
      break;
    }
  }
}


var CAN =
{
  SEEK_IDLE        : 0,
  SEEK_SOF         : 10,
  SEEK_BASE_ID     : 20,
  SEEK_FD_R0_BRS   : 30,
	SEEK_CAN_DLC         : 40,
  SEEK_FD_ESI_DLC  : 50,
  SEEK_IDE         : 70,
  SEEK_DATA        : 80,
  SEEK_CRC         : 90,
  SEEK_CRC_DEL     : 100,
  SEEK_ACK         : 110,
};



//Trigger sequence GUI
function on_draw_gui_trigger()
{
  ScanaStudio.gui_add_info_label("Trigger on specific CAN ID (or first bits of that ID). Type hex values (e.g. 0xAB1122) or decimal value (e.g. ‭11211042‬)");

  ScanaStudio.gui_add_new_selectable_containers_group("trg_alt","CAN ID Field length");
    ScanaStudio.gui_add_new_container("Standard 11-bits ID",true);
      ScanaStudio.gui_add_text_input("can_id_trig_std","CAN ID","0x123");
    ScanaStudio.gui_end_container();
    ScanaStudio.gui_add_new_container("Extended 29-bits ID",false);
      ScanaStudio.gui_add_text_input("can_id_trig_ext","CAN ID","0x11223344");
    ScanaStudio.gui_end_container();
  ScanaStudio.gui_end_selectable_containers_group();

  ScanaStudio.gui_add_new_tab("Data bytes", false);
    ScanaStudio.gui_add_info_label("Data bytes are optionnal and not aviable for CAN FD. Leave it empty if you don't wish to trigger on specific data bytes. Bytes must be written in the same order as they will appear on the CAN frame. You can either type in hexadecimal, decimal, or a mix of both. byte should be separated by a comma, e.g.: 0xA1,0xA2,0xA3");
    ScanaStudio.gui_add_text_input("can_trig_data","Data bytes","");
  ScanaStudio.gui_end_tab();

}

//Evaluate trigger GUI
function on_eval_gui_trigger()
{
  var can_id_trig_std = ScanaStudio.gui_get_value("can_id_trig_std");
  var can_id_trig_ext = ScanaStudio.gui_get_value("can_id_trig_ext");
  var trg_alt = ScanaStudio.gui_get_value("trg_alt");

  if (trg_alt == 0)
  {
      if(isNaN(can_id_trig_std))
      {
          return "Invalid CAN ID (not a number)";
      }
      else if(can_id_trig_std > 0x7FF)
      {
          return "Invalid CAN ID (more than 11 bits)";
      }
  }
  if (trg_alt == 1)
  {
      if(isNaN(can_id_trig_ext))
      {
          return "Invalid CAN ID (not a number)";
      }
      else if(can_id_trig_ext > 0x1FFFFFFF)
      {
          return "Invalid CAN ID (more than 29 bits)";
      }
  }
  return ""; //All good.
}

//Build trigger sequence
function on_build_trigger()
{
  var trg = TriggerObject;
  var can_id_trig_std = ScanaStudio.gui_get_value("can_id_trig_std");
  var can_id_trig_ext = ScanaStudio.gui_get_value("can_id_trig_ext");
  var trg_alt = ScanaStudio.gui_get_value("trg_alt");
  var data_string = ScanaStudio.gui_get_value("can_trig_data");
  var data_array = data_string.split(',');
  var number_array = []

  trg.configure(ScanaStudio.gui_get_value("ch"),
                ScanaStudio.gui_get_value("rate"),
                ScanaStudio.get_capture_sample_rate());


  var tmp;
  for (i = 0; i < data_array.length; i++)
  {
      tmp = Number(data_array[i].trim());
      if(!isNaN(tmp) && (data_string.length != 0))
      {
        number_array.push(tmp);
      }
  }

  if (trg_alt == 0) //STD, 11 bits ID
  {
    trg.build_trg_std(can_id_trig_std, number_array);
  }
  else
  {
    trg.build_trg_ext(can_id_trig_ext, number_array);
  }
}

TriggerObject = {
	build_trg_std : function(id,data_array)
  {
    stuffing_reset();
    this.put_trig_wait_idle();
    this.put_bit(0); //SOF
    this.put_word(id,11);
    if (data_array.length > 0)
    {
        this.put_bit(0); //RTR
        this.put_bit(0); //IDE = 0
        this.put_bit(0); //R0 //Always 0 for CAN frame (1 for CAN FD frames)
        this.put_word(data_array.length,4);
        for (i = 0; i < data_array.length; i++)
        {
          this.put_word(data_array[i],8);
        }
    }
    this.put_trig_end();
  },
  build_trg_ext : function(id,data_array)
  {
    stuffing_reset();
    this.put_trig_wait_idle();
    this.put_bit(0); //SOF
    this.put_word((id >> 18),11);
    this.put_bit(1); //SRR
    this.put_bit(1); //IDE = 1
    this.put_word((id) & 0x3FFFF,18);
    if (data_array.length > 0)
    {
        this.put_bit(0); //RTR
        this.put_bit(0); //R1
        this.put_bit(0); //R0 //Always 0 for CAN frame (1 for CAN FD frames)
        this.put_word(data_array.length,4);
        for (i = 0; i < data_array.length; i++)
        {
          this.put_word(data_array[i],8);
        }
    }
    this.put_trig_end();
  },
  put_word : function(words,len)
  {
    var i;
    for (i = (len-1); i >= 0; i--)
    {
      //ScanaStudio.console_info_msg("put_word:"+((words >> i) & 0x1));
      this.put_bit((words >> i) & 0x1);
    }
  },
  put_bit : function(b)
  {
    var sb = -1; //assume there is not bit stuffing
    sb = stuffing_build(b);
    if (sb >= 0) //add stuffed bit if needed
    {
      this.put_trig_step(sb);
    }
    this.put_trig_step(b);
  },
  put_trig_wait_idle : function()
  {
    var step_idle = "";
    var i;

    for (i = 0; i < ScanaStudio.get_device_channels_count(); i++)
    {
        if (i == this.channel)
        {
            step_idle = "1" + step_idle;
        }
        else
        {
            step_idle = "X" + step_idle;
        }
    }
    ScanaStudio.flexitrig_append(step_idle,-1,-1);
    this.last_level = 1;
    this.bits_count = 10;
  },
  put_trig_step : function(b)
  {
    var step = "";
    var i;
    var step_ch_desc;

    if (b == this.last_level)
    {
      this.bits_count++;
      return;
    }

    if (b == 0)
    {
        step_ch_desc = "F";
    }
    else
    {
        step_ch_desc = "R";
    }



    for (i = 0; i < ScanaStudio.get_device_channels_count(); i++)
    {
        if (i == this.channel)
        {
            step = step_ch_desc + step;
        }
        else
        {
            step = "X" + step;
        }
    }

    if (this.bits_count > 6) //in case of the start bit, no t_max constraint
    {
      //15% slack
      ScanaStudio.flexitrig_append(step,this.bits_count * this.bit_period * 0.85,-1);
    }
    else
    {
      //15% slack
      ScanaStudio.flexitrig_append(step,this.bits_count * this.bit_period * 0.85,this.bits_count * this.bit_period * 1.15);
    }

    this.last_level = b;
    this.bits_count = 1;
  },
  /*
  put_trig_end is used to add the very final trigger
  step, which is different than intermediary steps.
  The final step has only a "t_min" constrain,
  */
  put_trig_end : function()
  {
    var step_next = "";
    var i;
    var step

    if (this.last_level == 1)
    {
      step = "F";
    }
    else
    {
      step = "R";
    }

    for (i = 0; i < ScanaStudio.get_device_channels_count(); i++)
    {
      if (i == this.channel)
      {
        step_next = step + step_next;
      }
      else
      {
        step_next = "X" + step_next;
      }
    }
    ScanaStudio.flexitrig_append(step_next,this.bits_count * this.bit_period * 0.85,-1);
  },
  configure : function(channel,bitrate_std,sample_rate)
  {
    this.channel = channel;
    this.last_level;
    this.bits_count;
    this.bit_period = 1/bitrate_std;
  }
};


var can_state_machine = CAN.SEEK_IDLE;
var can_destuffed_bit_counter = 0; //count real bit (discarding stuffed bits)
var can_bits = [];
var can_byte_counter;
var can_base_id;
var is_can_fd_frame;
var is_fd_mode;
var last_packet_boudry; //TODO
var last_processed_bit;

function can_process_bit(b,sample_point,is_stuffed_bit)
{
  var i;
  if (can_state_machine == CAN.SEEK_SOF)
  {
    is_stuffed_bit = false; //SOF can never be a stuffed bit.
  }
  if (is_stuffed_bit && (last_processed_bit == b)) //Bit stuffing error!
  {

    start_sample = sample_point + dec_item_margin;
    end_sample = sample_point + samples_per_bit_std - dec_item_margin;
    ScanaStudio.dec_item_new( ch, start_sample,end_sample);
    ScanaStudio.dec_item_add_content("Stuffing error");
    ScanaStudio.dec_item_add_content("Error");
    ScanaStudio.dec_item_add_content("!E");
    ScanaStudio.dec_item_emphasize_error();
    ScanaStudio.dec_item_end();
    ScanaStudio.packet_view_add_packet(true, ch, start_sample, end_sample, "Error", "Stuffing error", ScanaStudio.PacketColors.Error.Title, ScanaStudio.PacketColors.Error.Content);
  }
  last_processed_bit = b;
  crc_acc(b,is_stuffed_bit);
  if (is_stuffed_bit)
  {
    can_bits.push([sample_point,"X",b]);
    //scanastudio.console_info_msg("+1 stuffed bit at " + sample_point,sample_point);
    return;
  }
  can_bits.push([sample_point,"U",b]);
  //ScanaStudio.console_info_msg( b +" bit",sample_point);

  switch (can_state_machine) {
    case CAN.SEEK_IDLE:
      if (b == 1)
      {
        can_state_machine = CAN.SEEK_SOF;
      }
      break;
    case CAN.SEEK_SOF: //Seek SOF
      if (b == 0)
      {
        stuff_mode = 1;
        stuffing_reset();
        stuffing_check(0);
        crc_reset();
        crc_acc(0,false);

        //Add start bit item
        start_sample = sample_point - sample_point_offset_std + dec_item_margin;
        end_sample = sample_point - sample_point_offset_std + samples_per_bit_std - dec_item_margin;
        ScanaStudio.dec_item_new( ch, start_sample, end_sample);
        ScanaStudio.dec_item_add_content("Start Of Frame");
        ScanaStudio.dec_item_add_content("SOF");
        ScanaStudio.dec_item_add_content("S");
        ScanaStudio.dec_item_add_sample_point(sample_point,"U");
        ScanaStudio.dec_item_end();
        ScanaStudio.packet_view_add_packet(true, ch, start_sample, -1, "CAN", "CH" + (ch + 1),
                                           ScanaStudio.get_channel_color(ch), ScanaStudio.get_channel_color(ch));
        ScanaStudio.packet_view_add_packet(false, ch, start_sample, end_sample, "SOF", "", ScanaStudio.PacketColors.Wrap.Title, ScanaStudio.PacketColors.Wrap.Content);

        can_bits = [];
        fd_mode = false;
        switch_to_high_baud_rate = false;
        switch_to_std_baud_rate = false;
        can_state_machine = CAN.SEEK_BASE_ID;
        is_can_fd_frame = false;
        is_fd_mode = false;
        crc_len = 15;
        can_destuffed_bit_counter = 0;
      }
      break;
    case CAN.SEEK_BASE_ID: //and also R1, IDE and R0
      can_destuffed_bit_counter++;
      if (can_destuffed_bit_counter == 14)
      {
        can_destuffed_bit_counter = 0;
        can_base_id = interpret_can_bits(can_bits,0,11);
        can_rtr_r1 = interpret_can_bits(can_bits,11,1);
        can_ide = interpret_can_bits(can_bits,12,1);
        can_r0 = interpret_can_bits(can_bits,13,1);

        //Base ID field
        start_sample = can_base_id.start - sample_point_offset_std + dec_item_margin;
        end_sample = can_base_id.end - sample_point_offset_std + samples_per_bit_std - dec_item_margin;
        ScanaStudio.dec_item_new( ch, start_sample, end_sample);
        ScanaStudio.dec_item_add_content("Base ID = " + format_content(can_base_id.value,id_format,11));
        ScanaStudio.dec_item_add_content(format_content(can_base_id.value,id_format,11));
        add_can_bits_sampling_points(can_bits,0,11);
        ScanaStudio.dec_item_end();
        ScanaStudio.packet_view_add_packet(false, ch, start_sample, end_sample, "Base ID", format_content(can_base_id.value,id_format,11),
                                           ScanaStudio.PacketColors.Head.Title, ScanaStudio.PacketColors.Head.Content);

        //RTR / R1 field
        start_sample = can_rtr_r1.start - sample_point_offset_std + dec_item_margin;
        end_sample = can_rtr_r1.end - sample_point_offset_std + samples_per_bit_std - dec_item_margin;
        ScanaStudio.dec_item_new( ch, start_sample, end_sample);
        add_can_bits_sampling_points(can_bits,11,1);
        if (can_ide.value == 0)
        {
          if (can_r0.value == 0)
          {
            ScanaStudio.dec_item_add_content("RTR");
            ScanaStudio.packet_view_add_packet(false, ch, start_sample, end_sample, "RTR", "",
                                               ScanaStudio.PacketColors.Preamble.Title, ScanaStudio.PacketColors.Preamble.Content);
            can_state_machine = CAN.SEEK_CAN_DLC;
          }
          else
          {
            is_can_fd_frame = true;
            ScanaStudio.dec_item_add_content("R1");
            ScanaStudio.packet_view_add_packet(false, ch, start_sample, end_sample, "R1", "",
                                               ScanaStudio.PacketColors.Preamble.Title, ScanaStudio.PacketColors.Preamble.Content);
            can_state_machine = CAN.SEEK_FD_R0_BRS;
          }
        }
        else
        {
          ScanaStudio.dec_item_add_content("SRR");
          ScanaStudio.packet_view_add_packet(false, ch, start_sample, end_sample, "SRR", "",
                                             ScanaStudio.PacketColors.Preamble.Title, ScanaStudio.PacketColors.Preamble.Content);
          can_state_machine = CAN.SEEK_IDE;
        }
        ScanaStudio.dec_item_end();

        //IDE Field
        start_sample = can_ide.start - sample_point_offset_std + dec_item_margin;
        end_sample = can_ide.end - sample_point_offset_std + samples_per_bit_std - dec_item_margin;
        ScanaStudio.dec_item_new( ch, start_sample, end_sample);
        add_can_bits_sampling_points(can_bits,12,1);
        ScanaStudio.dec_item_add_content("IDE = " + can_ide.value.toString());
        ScanaStudio.dec_item_add_content("IDE");
        ScanaStudio.dec_item_end();
        ScanaStudio.packet_view_add_packet(false, ch, start_sample, end_sample, "IDE", can_ide.value.toString(),
                                           ScanaStudio.PacketColors.Preamble.Title, ScanaStudio.PacketColors.Preamble.Content);

        //R0 - EDL (if not IDE)
        if (can_state_machine != CAN.SEEK_IDE)
        {
          start_sample = can_r0.start - sample_point_offset_std + dec_item_margin;
          end_sample = can_r0.end - sample_point_offset_std + samples_per_bit_std - dec_item_margin;
          ScanaStudio.dec_item_new( ch, start_sample, end_sample);
          if (can_r0.value == 0)
          {
            ScanaStudio.dec_item_add_content("R0 = " + can_r0.value.toString());
            ScanaStudio.dec_item_add_content("R0");
            ScanaStudio.packet_view_add_packet(false, ch, start_sample, end_sample, "R0", can_r0.value.toString(),
                                               ScanaStudio.PacketColors.Preamble.Title, ScanaStudio.PacketColors.Preamble.Content);
          }
          else
          {
            ScanaStudio.dec_item_add_content("EDL = " + can_r0.value.toString());
            ScanaStudio.dec_item_add_content("EDL");
            ScanaStudio.packet_view_add_packet(false, ch, start_sample, end_sample, "EDL", can_r0.value.toString(),
                                               ScanaStudio.PacketColors.Preamble.Title, ScanaStudio.PacketColors.Preamble.Content);
          }
          add_can_bits_sampling_points(can_bits,13,1);
          ScanaStudio.dec_item_end();

          can_bits = [];
        }
        else //It's a IDE frame, RO/EDL need to be counted in the IDE
        {
          can_destuffed_bit_counter = 1;
          can_bits = can_bits.slice(can_bits.length-1);
        }
      }
      break;
    case CAN.SEEK_IDE:
      can_destuffed_bit_counter++;
      if (can_destuffed_bit_counter == 21)
      {

        can_id_ext = interpret_can_bits(can_bits,0,18);
        can_full_id = (can_base_id.value << 18) | can_id_ext.value;
        can_rtr_r1 = interpret_can_bits(can_bits,18,1);
        can_r1_edl = interpret_can_bits(can_bits,19,1);
        can_r0 = interpret_can_bits(can_bits,20,1);

        //Base ID field
        start_sample = can_id_ext.start - sample_point_offset_std + dec_item_margin;
        end_sample = can_id_ext.end - sample_point_offset_std + samples_per_bit_std - dec_item_margin;
        ScanaStudio.dec_item_new( ch, start_sample, end_sample);
        ScanaStudio.dec_item_add_content("Full Extended ID = "+  format_content(can_full_id,id_format,29) + " (" + format_content(can_base_id.value,id_format,11) + " + " + format_content(can_id_ext.value,id_format,18) + ")");
        ScanaStudio.dec_item_add_content("Full ID " + format_content(can_full_id,id_format,29));
        ScanaStudio.dec_item_add_content(format_content(can_full_id,id_format,29));
        ScanaStudio.dec_item_add_content("ID Ext.");
        add_can_bits_sampling_points(can_bits,0,18);
        ScanaStudio.dec_item_end();
        ScanaStudio.packet_view_add_packet(false, ch, start_sample, end_sample, "Full ID", format_content(can_full_id,id_format,29),
                                           ScanaStudio.PacketColors.Head.Title, ScanaStudio.PacketColors.Head.Content);

        if (can_r1_edl.value == 0) //CAN Frame
        {
          //RTR
          start_sample = can_rtr_r1.start - sample_point_offset_std + dec_item_margin;
          end_sample = can_rtr_r1.end - sample_point_offset_std + samples_per_bit_std - dec_item_margin;
          ScanaStudio.dec_item_new( ch, start_sample, end_sample);
          add_can_bits_sampling_points(can_bits,18,1);
          ScanaStudio.dec_item_add_content("RTR = " + can_rtr_r1.value.toString());
          ScanaStudio.dec_item_add_content("RTR");
          ScanaStudio.dec_item_end();
          ScanaStudio.packet_view_add_packet(false, ch, start_sample, end_sample, "RTR", can_rtr_r1.value.toString(),
                                             ScanaStudio.PacketColors.Preamble.Title, ScanaStudio.PacketColors.Preamble.Content);
          //R1
          start_sample = can_r1_edl.start - sample_point_offset_std + dec_item_margin;
          end_sample = can_r1_edl.end - sample_point_offset_std + samples_per_bit_std - dec_item_margin;
          ScanaStudio.dec_item_new( ch, start_sample, end_sample);
          add_can_bits_sampling_points(can_bits,19,1);
          ScanaStudio.dec_item_add_content("R1 = " + can_r1_edl.value.toString());
          ScanaStudio.dec_item_add_content("R1");
          ScanaStudio.dec_item_end();
          ScanaStudio.packet_view_add_packet(false, ch, start_sample, end_sample, "R1", can_r1_edl.value.toString(),
                                             ScanaStudio.PacketColors.Preamble.Title, ScanaStudio.PacketColors.Preamble.Content);
        }
        else //CAN FD frame
        {
          is_can_fd_frame = true;
          //R1
          start_sample = can_rtr_r1.start - sample_point_offset_std + dec_item_margin;
          end_sample = can_rtr_r1.end - sample_point_offset_std + samples_per_bit_std - dec_item_margin;
          ScanaStudio.dec_item_new( ch, start_sample, end_sample);
          add_can_bits_sampling_points(can_bits,18,1);
          ScanaStudio.dec_item_add_content("R1 = " + can_rtr_r1.value.toString());
          ScanaStudio.dec_item_add_content("R1");
          ScanaStudio.dec_item_end();
          ScanaStudio.packet_view_add_packet(false, ch, start_sample, end_sample, "R1", can_rtr_r1.value.toString(),
                                             ScanaStudio.PacketColors.Preamble.Title, ScanaStudio.PacketColors.Preamble.Content);

          //EDL
          start_sample = can_r1_edl.start - sample_point_offset_std + dec_item_margin;
          end_sample = can_r1_edl.end - sample_point_offset_std + samples_per_bit_std - dec_item_margin;
          ScanaStudio.dec_item_new( ch, start_sample, end_sample);
          add_can_bits_sampling_points(can_bits,19,1);
          ScanaStudio.dec_item_add_content("EDL = " + can_r1_edl.value.toString());
          ScanaStudio.dec_item_add_content("EDL");
          ScanaStudio.dec_item_end();
          ScanaStudio.packet_view_add_packet(false, ch, start_sample, end_sample, "EDL", can_r1_edl.value.toString(),
                                             ScanaStudio.PacketColors.Preamble.Title, ScanaStudio.PacketColors.Preamble.Content);
        }

        if (is_can_fd_frame)
        {
          can_state_machine = CAN.SEEK_FD_R0_BRS;
          can_destuffed_bit_counter = 1;
          can_bits = can_bits.slice(can_bits.length-1);
        }
        else
        {
          //R0
          start_sample = can_r0.start - sample_point_offset_std + dec_item_margin;
          end_sample = can_r0.end - sample_point_offset_std + samples_per_bit_std - dec_item_margin;
          ScanaStudio.dec_item_new( ch, start_sample, end_sample);
          add_can_bits_sampling_points(can_bits,20,1);
          ScanaStudio.dec_item_add_content("R0 = " + can_r0.value.toString());
          ScanaStudio.dec_item_add_content("R0");
          ScanaStudio.dec_item_end();
          ScanaStudio.packet_view_add_packet(false, ch, start_sample, end_sample, "R0", can_r0.value.toString(),
                                             ScanaStudio.PacketColors.Preamble.Title, ScanaStudio.PacketColors.Preamble.Content);
          can_state_machine = CAN.SEEK_CAN_DLC;
          can_destuffed_bit_counter = 0;
          can_bits = [];
        }
      }
      break;
    case CAN.SEEK_CAN_DLC:
      can_destuffed_bit_counter++;
      if (can_destuffed_bit_counter == 4)
      {
        can_destuffed_bit_counter = 0;
        can_dlc = interpret_can_bits(can_bits,0,4);
        can_len = can_dlc.value;
        if (can_len > 8) can_len = 8;

        start_sample = can_dlc.start - sample_point_offset_std + dec_item_margin;
        end_sample = can_dlc.end - sample_point_offset_std + samples_per_bit_std - dec_item_margin;
        ScanaStudio.dec_item_new( ch, start_sample, end_sample);
        ScanaStudio.dec_item_add_content("DLC = " + can_dlc.value.toString());
        ScanaStudio.dec_item_add_content(can_dlc.value.toString());
        add_can_bits_sampling_points(can_bits,0,4);
        ScanaStudio.dec_item_end();
        ScanaStudio.packet_view_add_packet(false, ch, start_sample, end_sample, "DLC", can_dlc.value.toString(),
                                           ScanaStudio.PacketColors.Preamble.Title, ScanaStudio.PacketColors.Preamble.Content);

        if (can_len > 0)
        {
          can_state_machine = CAN.SEEK_DATA;
        }
        else
        {
          if (is_can_fd_frame)
          {
            stuff_mode = 2;
            recalculated_crc = crc_calc(crc_bits_all,crc_len)
          }
          else
          {
            stuff_mode = 1;
            recalculated_crc = crc_calc(crc_bits_destuffed,crc_len)
          }
          can_state_machine = CAN.SEEK_CRC;
        }
        can_byte_counter = 0;
        can_bits = [];
      }
      break;
    case CAN.SEEK_FD_R0_BRS:
      can_destuffed_bit_counter++;
      if (can_destuffed_bit_counter == 2)
      {
        can_destuffed_bit_counter = 0;
        can_r0 = interpret_can_bits(can_bits,0,1);
        can_brs = interpret_can_bits(can_bits,1,1);

        start_sample = can_r0.start - sample_point_offset_std + dec_item_margin;
        end_sample = can_r0.end - sample_point_offset_std + samples_per_bit_std - dec_item_margin;
        ScanaStudio.dec_item_new( ch, start_sample, end_sample);
        ScanaStudio.dec_item_add_content("R0");
        add_can_bits_sampling_points(can_bits,0,1);
        ScanaStudio.dec_item_end();
        ScanaStudio.packet_view_add_packet(false, ch, start_sample, end_sample, "R0", "",
                                           ScanaStudio.PacketColors.Preamble.Title, ScanaStudio.PacketColors.Preamble.Content);
        if (can_brs.value == 1)
        {
          start_sample = can_brs.start - sample_point_offset_std + (samples_per_brs_bit/50);
          end_sample = can_brs.end - sample_point_offset_std + samples_per_brs_bit - (samples_per_brs_bit/50);
          ScanaStudio.dec_item_new( ch, start_sample, end_sample);
          ScanaStudio.dec_item_add_content("BRS = 1 (Switching bit rate)");
          ScanaStudio.dec_item_add_content("BRS = 1");
          ScanaStudio.packet_view_add_packet(false, ch, start_sample, end_sample, "BRS", "Switching bit rate",
                                             ScanaStudio.PacketColors.Misc.Title, ScanaStudio.PacketColors.Misc.Content);

          //scanastudio.console_info_msg("Switching to high bit rate on next bit, at cursor = " + sample_point,sample_point);
          switch_to_high_baud_rate = true;
          is_fd_mode = true;
          samples_per_bit = samples_per_bit_fd;
          sample_point_offset = sample_point_offset_fd;
        }
        else
        {
          start_sample = can_brs.start - sample_point_offset_std + dec_item_margin;
          end_sample = can_brs.end - sample_point_offset_std + samples_per_bit_std - dec_item_margin;
          ScanaStudio.dec_item_new( ch, start_sample, end_sample);
          ScanaStudio.dec_item_add_content("BRS = 0 (No bitrate switch)");
          ScanaStudio.dec_item_add_content("BRS = 0");
          ScanaStudio.packet_view_add_packet(false, ch, start_sample, end_sample, "BRS", "No bitrate switch",
                                             ScanaStudio.PacketColors.Misc.Title, ScanaStudio.PacketColors.Misc.Content);
        }
        add_can_bits_sampling_points(can_bits,1,1);
        ScanaStudio.dec_item_end();

        can_bits = [];
        can_state_machine = CAN.SEEK_FD_ESI_DLC;
      }
      break;
    case CAN.SEEK_FD_ESI_DLC:
      can_destuffed_bit_counter++;
      if (can_destuffed_bit_counter == 5)
      {
        can_destuffed_bit_counter = 0;
        can_esi = interpret_can_bits(can_bits,0,1);
        can_dlc = interpret_can_bits(can_bits,1,4);
        can_len = get_data_len(can_dlc.value);

        start_sample = can_esi.start - sample_point_offset + dec_item_margin;
        end_sample = can_esi.end - sample_point_offset + samples_per_bit - dec_item_margin;
        ScanaStudio.dec_item_new( ch, start_sample, end_sample);
        ScanaStudio.dec_item_add_content("ESI = " + can_esi.value.toString());
        ScanaStudio.dec_item_add_content("ESI");
        if (can_esi.value == 0)
        {
          ScanaStudio.dec_item_emphasize_warning();
        }
        add_can_bits_sampling_points(can_bits,0,1);
        ScanaStudio.dec_item_end();
        ScanaStudio.packet_view_add_packet(false, ch, start_sample, end_sample, "ESI", can_esi.value.toString(),
                                           ScanaStudio.PacketColors.Misc.Title, ScanaStudio.PacketColors.Misc.Content);

        start_sample = can_dlc.start - sample_point_offset + dec_item_margin;
        end_sample = can_dlc.end - sample_point_offset + samples_per_bit - dec_item_margin;
        ScanaStudio.dec_item_new( ch, start_sample, end_sample);
        ScanaStudio.dec_item_add_content("DLC = " + can_dlc.value.toString() + ", Data length = " + can_len.toString());
        ScanaStudio.dec_item_add_content("Length = " + can_len.toString());
        ScanaStudio.dec_item_add_content(can_len.toString());
        add_can_bits_sampling_points(can_bits,1,4);
        ScanaStudio.dec_item_end();
        ScanaStudio.packet_view_add_packet(false, ch, start_sample, end_sample, "DLC",
                                           "DLC = " + can_dlc.value.toString() + ", Data length = " + can_len.toString(),
                                           ScanaStudio.PacketColors.Misc.Title, ScanaStudio.PacketColors.Misc.Content);

        crc_len = crc_get_len(can_len);

        if (can_len > 0)
        {
          can_state_machine = CAN.SEEK_DATA;
        }
        else
        {
          stuff_mode = 2;
          recalculated_crc = crc_calc(crc_bits_all,crc_len);
          can_state_machine = CAN.SEEK_CRC;
        }
        can_byte_counter = 0;
        can_bits = [];
      }
      break;
    case CAN.SEEK_DATA:
      can_destuffed_bit_counter++;
      if (can_destuffed_bit_counter == 8)
      {
        can_destuffed_bit_counter = 0;
        can_data = interpret_can_bits(can_bits,0,8);

        start_sample = can_data.start - sample_point_offset + dec_item_margin;
        end_sample = can_data.end - sample_point_offset + samples_per_bit - dec_item_margin;
        ScanaStudio.dec_item_new( ch, start_sample, end_sample);
        ScanaStudio.dec_item_add_content("DATA = " + format_content(can_data.value,data_format,8));
        ScanaStudio.dec_item_add_content(format_content(can_data.value,data_format,8));
        add_can_bits_sampling_points(can_bits,0,8);
        ScanaStudio.dec_item_end();
        ScanaStudio.packet_view_add_packet(false, ch, start_sample, end_sample, "Data", format_content(can_data.value,data_format,8),
                                           ScanaStudio.PacketColors.Data.Title, ScanaStudio.PacketColors.Data.Content);
        can_byte_counter++;
        can_bits = [];
        if (can_byte_counter >= can_len)
        {
          if (is_can_fd_frame)
          {
            stuff_mode = 2;
          }
          else
          {
            stuff_mode = 1;
          }

          if (is_can_fd_frame)
          {
            recalculated_crc = crc_calc(crc_bits_all,crc_len)
          }
          else
          {
            recalculated_crc = crc_calc(crc_bits_destuffed,crc_len)
          }
          can_state_machine = CAN.SEEK_CRC;
          can_destuffed_bit_counter = 0;
        }
      }
      break;
    case CAN.SEEK_CRC:
      can_destuffed_bit_counter++;
      //ScanaStudio.console_info_msg("CRC bits..."+can_destuffed_bit_counter+"/"+crc_len,sample_point);
      if (can_destuffed_bit_counter == crc_len)
      {
        can_destuffed_bit_counter = 0;
        can_crc = interpret_can_bits(can_bits,0,crc_len);

        start_sample = can_crc.start - sample_point_offset + dec_item_margin;
        end_sample = can_crc.end - sample_point_offset + samples_per_bit - dec_item_margin;
        ScanaStudio.dec_item_new( ch, start_sample, end_sample);

        if (can_crc.value == recalculated_crc)
        {
          ScanaStudio.dec_item_emphasize_success();
          ScanaStudio.dec_item_add_content("CRC = " + format_content(can_crc.value,data_format,crc_len) + " OK!");
          ScanaStudio.packet_view_add_packet(false, ch, start_sample, end_sample, "CRC",
                                             format_content(can_crc.value,data_format,crc_len) + " OK",
                                             ScanaStudio.PacketColors.Check.Title, ScanaStudio.PacketColors.Check.Content);
        }
        else
        {
          ScanaStudio.dec_item_emphasize_warning();
          ScanaStudio.dec_item_add_content("CRC = " + format_content(can_crc.value,data_format,crc_len) + ", should be 0x" + recalculated_crc.toString(16));
          ScanaStudio.packet_view_add_packet(false, ch, start_sample, end_sample,
                                             "CRC", format_content(can_crc.value, data_format, crc_len) + ", should be 0x" + recalculated_crc.toString(16),
                                             ScanaStudio.PacketColors.Error.Title, ScanaStudio.PacketColors.Error.Content);
        }
        ScanaStudio.dec_item_add_content(format_content(can_crc.value,data_format,crc_len));
        add_can_bits_sampling_points(can_bits,0,crc_len);
        ScanaStudio.dec_item_end();

        can_bits = [];
        can_state_machine = CAN.SEEK_CRC_DEL;
      }
      break;
    case CAN.SEEK_CRC_DEL: //CRC Delimiter, this is also where we switch back from FD mode to std bitrate
      can_destuffed_bit_counter++;
      if (can_destuffed_bit_counter == 1)
      {
        can_destuffed_bit_counter = 0;
        can_crc_del = interpret_can_bits(can_bits,0,1);

        //CRC Delimiter
        if (is_fd_mode)
        {
          start_sample = can_crc_del.start - sample_point_offset + dec_item_margin;
          end_sample = can_crc_del.end - sample_point_offset + samples_per_fd_crc_del_bit - dec_item_margin;
        }
        else
        {
          start_sample = can_crc_del.start - sample_point_offset_std + dec_item_margin;
          end_sample = can_crc_del.end - sample_point_offset_std + samples_per_bit_std - dec_item_margin;
        }

        ScanaStudio.dec_item_new( ch, start_sample, end_sample);

        if (can_crc_del.value == 1)
        {
          ScanaStudio.dec_item_add_content("CRC Delimiter");
          ScanaStudio.dec_item_add_content("CRC Del.");
          ScanaStudio.dec_item_add_content("Del.");
          ScanaStudio.dec_item_add_content("D");
        }
        else
        {
          ScanaStudio.dec_item_add_content("CRC Delimiter missing");
          ScanaStudio.dec_item_add_content("!CRC Del.");
          ScanaStudio.dec_item_add_content("!Del.");
          ScanaStudio.dec_item_emphasize_error();
          ScanaStudio.packet_view_add_packet(false, ch, start_sample, end_sample, "Delimiter", "CRC Delimiter missing", ScanaStudio.PacketColors.Error.Title, ScanaStudio.PacketColors.Error.Content);
        }
        add_can_bits_sampling_points(can_bits,0,1);
        ScanaStudio.dec_item_end();

        if (is_fd_mode)
        {
          switch_to_std_baud_rate = true;
        }
        can_bits = [];
        stuff_mode = 0; //No more bit stuffing after this point (even for CAN FD)
        can_state_machine = CAN.SEEK_ACK;
      }
      break;
    case CAN.SEEK_ACK: //ACK, DEL, EOF //TODO: rename this to "EOF_BITS", not just "ACK"
      can_destuffed_bit_counter++;
      if (can_destuffed_bit_counter == 3)
      {
        can_destuffed_bit_counter = 0;

        can_ack = interpret_can_bits(can_bits,0,1);
        can_ack_del = interpret_can_bits(can_bits,1,1);
        can_eof = interpret_can_bits(can_bits,2,1);

        //ACK
        start_sample = can_ack.start - sample_point_offset_std + dec_item_margin;
        end_sample = can_ack.end - sample_point_offset_std + samples_per_bit_std - dec_item_margin;
        ScanaStudio.dec_item_new( ch, start_sample, end_sample);

        if (can_ack.value == 0)
        {
          ScanaStudio.dec_item_add_content("Acknowledge");
          ScanaStudio.dec_item_add_content("ACK");
          ScanaStudio.dec_item_add_content("A");
          ScanaStudio.packet_view_add_packet(false, ch, start_sample, end_sample, "ACK", "",
                                             ScanaStudio.PacketColors.Check.Title, ScanaStudio.PacketColors.Check.Content);
        }
        else
        {
          ScanaStudio.dec_item_add_content("No Acknowledge");
          ScanaStudio.dec_item_add_content("NO ACK");
          ScanaStudio.dec_item_add_content("!A");
          ScanaStudio.dec_item_emphasize_warning();
          ScanaStudio.packet_view_add_packet(false, ch, start_sample, end_sample, "NACK", "",
                                             ScanaStudio.PacketColors.Error.Title, ScanaStudio.PacketColors.Error.Content);
        }

        add_can_bits_sampling_points(can_bits,0,1);
        ScanaStudio.dec_item_end();

        //ACK DEL
        start_sample = can_ack_del.start - sample_point_offset_std + dec_item_margin;
        end_sample = can_ack_del.end - sample_point_offset_std + samples_per_bit_std - dec_item_margin;
        ScanaStudio.dec_item_new( ch, start_sample, end_sample);

        if (can_ack_del.value == 1)
        {
          ScanaStudio.dec_item_add_content("Acknowledge Delimiter");
          ScanaStudio.dec_item_add_content("ACK Del.");
          ScanaStudio.dec_item_add_content("Del.");
          ScanaStudio.dec_item_add_content("D");
        }
        else
        {
          ScanaStudio.dec_item_add_content("ACK Delimiter missing");
          ScanaStudio.dec_item_add_content("!ACK Del.");
          ScanaStudio.dec_item_add_content("!Del.");
          ScanaStudio.dec_item_emphasize_error();
          ScanaStudio.packet_view_add_packet(false, ch, start_sample, end_sample, "Delimiter", "ACK Delimiter missing",
                                             ScanaStudio.PacketColors.Error.Title, ScanaStudio.PacketColors.Error.Content);
        }

        add_can_bits_sampling_points(can_bits,1,1);
        ScanaStudio.dec_item_end();

        //EOF
        start_sample = can_eof.start - sample_point_offset_std + dec_item_margin;
        end_sample = can_eof.end - sample_point_offset_std + samples_per_bit_std - dec_item_margin;
        ScanaStudio.dec_item_new( ch, start_sample, end_sample);

        if (can_eof.value == 1)
        {
          ScanaStudio.dec_item_add_content("End of Frame");
          ScanaStudio.dec_item_add_content("EOF");
          ScanaStudio.dec_item_add_content("E");
          ScanaStudio.packet_view_add_packet(false, ch, start_sample, end_sample, "EOF", "",
                                             ScanaStudio.PacketColors.Wrap.Title, ScanaStudio.PacketColors.Wrap.Content);
        }
        else
        {
          ScanaStudio.dec_item_add_content("EOF missing");
          ScanaStudio.dec_item_add_content("!EOF");
          ScanaStudio.dec_item_add_content("!E");
          ScanaStudio.dec_item_emphasize_error();

          ScanaStudio.packet_view_add_packet(false, ch, start_sample, end_sample, "EOF missing", "",
                                             ScanaStudio.PacketColors.Error.Title, ScanaStudio.PacketColors.Error.Content);
        }

        add_can_bits_sampling_points(can_bits,2,1);
        ScanaStudio.dec_item_end();

        can_bits = [];
        can_state_machine = CAN.SEEK_IDLE;

      }
    default:
  }
}

/*
  Start and n_bits are expressed in terms of destuffed bits
  returns a can_field() object
*/
function interpret_can_bits(can_bits_array,start,n_bits)
{
  var i,db_cnt,len;
  var ret = new can_field();
  db_cnt = len = 0;
  ret.value = 0
  for (i = 0; i < can_bits.length; i++)
  {
    if (can_bits[i][1] != "X")
    {
      if (db_cnt == start)
      {
        ret.start = can_bits[i][0];
      }
      if (db_cnt >= start)
      {
        ret.value = (ret.value * 2) + can_bits[i][2];
        len++;
      }
      db_cnt++;
      if (len >= n_bits)
      {
        ret.end = can_bits[i][0];
        break;
      }
    }
  }
  return ret;
}

/*
  Start and n_bits are expressed in terms of destuffed bits
*/
function add_can_bits_sampling_points(can_bits_array,start,n_bits)
{
  var i,db_cnt,len;
  db_cnt = len = 0;
  for (i = 0; i < can_bits_array.length; i++)
  {
    if (can_bits[i][1] != "X")
    {
      if (db_cnt >= start)
      {
        len++;
      }
      db_cnt++;
    }
    if (db_cnt > start)
    {
      ScanaStudio.dec_item_add_sample_point(can_bits_array[i][0],can_bits_array[i][1]);
    }
    if (len >= n_bits)
    {
      break;
    }
  }
}

function can_field()
{
  this.value = 0;
  this.start = 0;
  this.end = 0;
}

//Function called to generate demo siganls (when no physical device is attached)
function on_build_demo_signals()
{
  //Use the function below to get the number of samples to be built
  var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
  sampling_rate = ScanaStudio.get_capture_sample_rate();
  var silence_period_samples = 1000 + (samples_to_build / 125);
  var builder = ScanaStudio.BuilderObject;
  ch = ScanaStudio.gui_get_value("ch");
  rate = ScanaStudio.gui_get_value("rate");
  rate_fd = ScanaStudio.gui_get_value("rate_fd");

  builder.configure(ch,rate,rate_fd,sampling_rate);
  builder.put_silence(1e3);
  //builder.put_can_ext_frame(0x69F,build_sample_data(64));
  builder.put_silence(100e3);
  builder.put_can_frame(0x69F,[0,1]);
  //builder.put_silence(10e3);
  //return;
  while (ScanaStudio.builder_get_samples_acc(ch) < samples_to_build)
  {
    random_frame_type = Math.floor(Math.random()*3.9);
    switch (random_frame_type)
    {
      case 0:
        random_id = Math.floor(Math.random()*(0x7FF));
        random_len = Math.floor(Math.random()*(8.9));
        sample_data = build_sample_data(random_len);
        builder.put_can_frame(random_id,sample_data);
        break;
      case 1:
        random_id = Math.floor(Math.random()*(Math.pow(2,29)));
        random_len = Math.floor(Math.random()*(8.9));
        sample_data = build_sample_data(random_len);
        builder.put_can_ext_frame(random_id,sample_data);
        break;
      case 2:
        random_id = Math.floor(Math.random()*(0x7FF));
        random_len = get_data_len(Math.floor(Math.random()*(15.9)));
        sample_data = build_sample_data(random_len);
        builder.put_can_fd_frame(random_id,sample_data);
        break;
      case 3:
        random_id = Math.floor(Math.random()*(Math.pow(2,29)));
        random_len = get_data_len(Math.floor(Math.random()*(15.9)));
        sample_data = build_sample_data(random_len);
        builder.put_can_fd_ext_frame(random_id,sample_data);
        break;
      default:
    }
    builder.put_silence(silence_period_samples);
  }

}

function build_sample_data(len)
{
  sample_data = [];
  var i = 0;
  for (i = 0; i < len; i++)
  {
    sample_data.push(Math.floor(Math.random()*0xFF));
  }
  return sample_data;
}


//Builder object that can be shared to other scripts
ScanaStudio.BuilderObject = {
  //to be configured by the user of this object using the setter functions below
  channel: 0,
  sampling_rate: 1e6,
	put_can_frame : function(id,data_array)
  {
    var i,crc;
    stuffing_reset();
    crc_reset();
    this.stuffing_mode(1); //Standard bit stuffing
    this.bitrate_std(); //Ensure we use standard bit rate
    this.put_bit(0); //SOF
    this.put_word(id,11);
    if (data_array.length > 0)
    {
        this.put_bit(0); //RTR
    }
    else
    {
      this.put_bit(1); //RTR
    }
    this.put_bit(0); //IDE = 0
    this.put_bit(0); //R0 //Always 0 for CAN frame (1 for CAN FD frames)
    this.put_word(data_array.length,4);
    for (i = 0; i < data_array.length; i++)
    {
      this.put_word(data_array[i],8);
    }
    crc = crc_calc(crc_bits_destuffed,15);
    this.put_word(crc,15); //CRC
    this.put_bit(1); //CRC DEL
    this.stuffing_mode(0);
    this.put_bit(0); //ACK
    this.put_bit(1); //ACK DEL
    this.put_bit(1); //EOF
    this.put_bit(1); //Interframe Space
  },
  put_can_fd_frame : function(id,data_array)
  {
    var i,crc;
    stuffing_reset();
    crc_reset();
    this.stuffing_mode(1); //Standard bit stuffing
    this.bitrate_std(); //Ensure we use standard bit rate
    this.put_bit(0); //SOF
    this.put_word(id,11)
    this.put_bit(0); //R1
    this.put_bit(0); //IDE = 0
    this.put_bit(1); //EDL
    this.put_bit(0); //R0
    this.put_brs_bit(1);
    this.bitrate_fd(); //Switch to FD bitrate
    this.put_bit(1); //ESI
    this.put_word( get_dlc(data_array.length) ,4);
    for (i = 0; i < data_array.length; i++)
    {
      this.put_word(data_array[i],8);
    }
    crc = crc_calc(crc_bits_all,crc_get_len(data_array.length));
    this.stuffing_mode(2); //Switch to stuffing mode 2 (stuff in CRC)
    this.put_word(crc,crc_get_len(data_array.length)); //CRC
    this.put_fd_crc_del(1); //CRC DEL
    this.bitrate_std(); //Switch back to standard bit rate
    this.stuffing_mode(0);
    this.put_bit(0); //ACK
    this.put_bit(1); //ACK DEL
    this.put_bit(1); //EOF
    this.put_bit(1); //Interframe Space
  },
  put_can_ext_frame : function(id,data_array)
  {
    var i,crc;
    stuffing_reset();
    crc_reset();
    this.stuffing_mode(1); //Standard bit stuffing
    this.bitrate_std(); //Ensure we use standard bit rate
    this.put_bit(0); //SOF
    //ScanaStudio.console_info_msg("base id="+((id >> 18) & 0x7FF));
    this.put_word((id >> 18) ,11);
    this.put_bit(1); //SRR
    this.put_bit(1); //IDE = 1
    this.put_word((id) & 0x3FFFF,18);
    if (data_array.length > 0)
    {
        this.put_bit(0); //RTR
    }
    else
    {
      this.put_bit(1); //RTR
    }
    this.put_bit(0); //R1
    this.put_bit(0); //R0 //Always 0 for CAN frame (1 for CAN FD frames)
    this.put_word(data_array.length,4);
    for (i = 0; i < data_array.length; i++)
    {
      this.put_word(data_array[i],8);
    }
    crc = crc_calc(crc_bits_destuffed,15);
    this.put_word(crc,15); //CRC
    this.put_bit(1); //CRC DEL
    this.stuffing_mode(0);
    this.put_bit(0); //ACK
    this.put_bit(1); //ACK DEL
    this.put_bit(1); //EOF
    this.put_bit(1); //Interframe Space
  },
  put_can_fd_ext_frame : function(id,data_array)
  {
    var i,crc;
    stuffing_reset();
    crc_reset();
    this.stuffing_mode(1); //Standard bit stuffing
    this.bitrate_std(); //Ensure we use standard bit rate
    this.put_bit(0); //SOF
    this.put_word((id >> 18) ,11);
    this.put_bit(1); //SRR
    this.put_bit(1); //IDE = 1
    this.put_word((id) & 0x3FFFF,18);
    this.put_bit(0); //R1
    this.put_bit(1); //EDL
    this.put_bit(0); //R0
    this.put_brs_bit(1);
    this.bitrate_fd(); //Switch to FD bitrate
    this.put_bit(1); //ESI
    this.put_word( get_dlc(data_array.length) ,4); //DLC
    for (i = 0; i < data_array.length; i++)
    {
      this.put_word(data_array[i],8);
    }
    crc = crc_calc(crc_bits_all,crc_get_len(data_array.length));
    this.stuffing_mode(2); //Switch to stuffing mode 2 (stuff in CRC)
    this.put_word(crc,crc_get_len(data_array.length)); //CRC
    this.put_fd_crc_del(1); //CRC DEL
    this.bitrate_std(); //Switch back to standard bit rate
    this.stuffing_mode(0);
    this.put_bit(0); //ACK
    this.put_bit(1); //ACK DEL
    this.put_bit(1); //EOF
    this.put_bit(1); //Interframe Space
  },
  put_word : function(words,len)
  {
    var i;
    for (i = (len-1); i >= 0; i--)
    {
      this.put_bit((words >> i) & 0x1);
    }
  },
  put_silence : function(samples)
  {
    ScanaStudio.builder_add_samples(this.channel,1,samples);
  },
  put_bit : function(b)
  {
    var sb = -1; //assume there is not bit stuffing
    if (this.stuffing == 1)
    {
      sb = stuffing_build(b);
    }
    else if (this.stuffing == 2)
    {
      sb = stuffing_build_fd_crc(b);
    }
    if (sb >= 0) //add stuffed bit if needed
    {
      //ScanaStudio.console_info_msg("*SB="+sb);
      crc_acc(sb,true);
      ScanaStudio.builder_add_samples(this.channel,sb,this.samples_per_bit);
    }
    //ScanaStudio.console_info_msg("B="+b + ", stuff_count=" + stuff_counter);
    crc_acc(b,false);
    ScanaStudio.builder_add_samples(this.channel,b,this.samples_per_bit);
  },
  put_brs_bit : function(b) //Baud rate switch
  {
    var sb = -1; //assume there is not bit stuffing
    if (this.stuffing == 1)
    {
      sb = stuffing_build(b);
    }
    else if (this.stuffing == 2)
    {
      sb = stuffing_build_fd_crc(b);
    }
    if (sb >= 0) //add stuffed bit if needed
    {
      crc_acc(sb,true);
      ScanaStudio.builder_add_samples(this.channel,sb,this.samples_per_bit);
    }
    crc_acc(b,false);
    ScanaStudio.builder_add_samples(this.channel,b,this.samples_per_brs_bit);
  },
  put_fd_crc_del : function(b) //CRC delimiter for CAN FD frame, when baud rate is switched back
  {
    var sb = -1; //assume there is not bit stuffing
    if (this.stuffing == 1)
    {
      sb = stuffing_build(b);
    }
    else if (this.stuffing == 2)
    {
      sb = stuffing_build_fd_crc(b);
    }
    if (sb >= 0) //add stuffed bit if needed
    {
      crc_acc(sb,true);
      ScanaStudio.builder_add_samples(this.channel,sb,this.samples_per_bit);
    }
    crc_acc(b,false);
    ScanaStudio.builder_add_samples(this.channel,b,this.samples_per_fd_crc_del_bit);
  },
  stuffing_mode : function (m) // 0=Off (for default CRC), 1= Normal stuffing, 2= CRC FD stuffing
  {
    this.stuffing = m;
  },
  bitrate_std : function()
  {
    this.samples_per_bit = this.samples_per_bit_std;
  },
  bitrate_fd : function()
  {
    this.samples_per_bit = this.samples_per_bit_fd;
  },
  configure : function(channel,bitrate_std,bitrate_fd,sample_rate)
  {
    this.channel = channel;
    this.samples_per_bit_std = sample_rate/bitrate_std;
    this.samples_per_bit_fd = sample_rate/bitrate_fd;
    this.samples_per_brs_bit = (this.samples_per_bit_std*11/15) + (this.samples_per_bit_fd*4/10);
    this.samples_per_fd_crc_del_bit = (this.samples_per_bit_fd*6/10) + (this.samples_per_bit_std*4/15);
    this.bitrate_std();
  }
};

/******************************************
          /Helper functions/
******************************************/

/**
Check if next bit should be a stuffed bit.
returns the stuffed bit value (0 or 1) if a suffed bit is needed
returns -1 if no bit stuff is needed
*/
var stuff_counter = 0;
var stuff_crc_counter = 0;
var stuff_last_bit;
var stuff_first_crc_bit = true;
function stuffing_build(b)
{
  var ret = -1;

  if (stuff_counter >= 5)
  {
    ret =  (!stuff_last_bit) & 0x1;
    stuff_counter = 1;
    if (ret == b)
    {
      stuff_counter++;
    }
  }
  else if (b == stuff_last_bit)
  {
      stuff_counter++;
  }
  else
  {
    stuff_counter = 1;
  }

  stuff_last_bit = b;
  return ret;
}

function stuffing_check(b)
{
  var ret = -1;
  stuff_counter++;
  if (stuff_counter >= 5)
  {
    ret =  (!stuff_last_bit) & 0x1;
    stuff_counter = 0;
  }
  else
  {
  }
  if (b != stuff_last_bit)
  {
    stuff_counter = 0;
  }
  stuff_last_bit = b;
  return ret;
}

/**
Same as check_stuffing but for the CRC field of CAN FD frames
where different stuffing rules applies
*/
function stuffing_build_fd_crc(b)
{
  var ret = -1;
  stuff_crc_counter++;
  if ((stuff_crc_counter >= 4) || (stuff_first_crc_bit))
  {
    ret =  (!stuff_last_bit) & 0x1;
    stuff_crc_counter = 0;
    stuff_first_crc_bit = false;
  }

  stuff_last_bit = b;
  return ret;
}

function stuffing_check_fd_crc(b)
{
  var ret = -1;
  stuff_crc_counter++;
  if ((stuff_crc_counter >= 5) || (stuff_first_crc_bit))
  {
    ret =  (!stuff_last_bit) & 0x1;
    stuff_crc_counter = 0;
    stuff_first_crc_bit = false;
  }

  stuff_last_bit = b;
  return ret;
}

function stuffing_reset()
{
  stuff_crc_counter = 0;
  stuff_counter = 0;
  stuff_first_crc_bit = true;
  stuff_last_bit = -1; //improbable value, to ensure next bit resets the stuffing counter
}

// CRC function
var crc_bits_destuffed = [];
var crc_bits_all = [];
function crc_reset()
{
  crc_bits_destuffed = [];
  crc_bits_all = [];
}

function crc_acc(b,is_stuffed_bit)
{
  b = Number(b);
  if (is_stuffed_bit == false)
  {
      crc_bits_destuffed.push(b);
      crc_bits_all.push(b);
  }
  else
  {
    crc_bits_all.push(b);
  }
}

function crc_get_len(n_data_bytes)
{
  var len;
  if (n_data_bytes > 16)
  {
    len = 21;
  }
  else
  {
    len = 17;
  }
  return len;
}

function crc_calc(bits,crc_len)
{
  var crc_nxt;
  var crc = 0;
  var b = 0;
  var poly;
  switch (crc_len) {
    case 17:
      poly = 0x3685B;
      break;
    case 21:
      poly = 0x302899;
      break;
    default:
      poly = 0xC599;
  }

  bits_sequence = "";
  for (b = 0; b < bits.length; b++)
  {
    bits_sequence += bits[b].toString();
    crc_nxt = bits[b] ^ ((crc >> (crc_len-1))&0x1);
    crc = crc << 1;
    crc &= 0xFFFFFFFE;
    if (crc_nxt == 1)
    {
      crc = (crc ^ (poly & ~(1 << (crc_len))))
      //TODO: can't we just write crc = (crc ^ poly) ?
    }
    crc &= ~(1 << (crc_len));
  }
  return crc;
}

function get_data_len(dlc_code)
{
  var can_len;
  switch (dlc_code) {
          case 9:
            can_len = 12;
            break;
          case 10:
            can_len = 16;
            break;
          case 11:
            can_len = 20;
            break;
          case 12:
            can_len = 24;
            break;
          case 13:
            can_len = 32;
            break;
          case 14:
            can_len = 48;
            break;
          case 15:
            can_len = 64;
            break;
          default:
            can_len = dlc_code;
        }
  return can_len;
}

function get_dlc(data_len)
{
  var dlc;
  if (data_len <= 8)
  {
    dlc = data_len;
  }
  else if (data_len == 12)
  {
    dlc = 9;
  }
  else if (data_len == 16)
  {
    dlc = 10;
  }
  else if (data_len == 20)
  {
    dlc = 11;
  }
  else if (data_len == 24)
  {
    dlc = 12;
  }
  else if (data_len == 32)
  {
    dlc = 13;
  }
  else if (data_len == 48)
  {
    dlc = 14;
  }
  else
  {
    dlc = 15;
  }

  return dlc;
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
