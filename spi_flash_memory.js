/* Protocol meta info:
<NAME> SPI Flash memory </NAME>
<DESCRIPTION>
 SPI Flash memory transactions analyzer
</DESCRIPTION>
<VERSION> 0.2 </VERSION>
<AUTHOR_NAME>  Ibrahim KAMAL </AUTHOR_NAME>
<AUTHOR_URL> i.kamal@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki/SPI-Flash-memory-instructions-analyzer </HELP_URL>
<COPYRIGHT> Copyright Ibrahim KAMAL </COPYRIGHT>
<LICENSE>  This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.2: Added dec_item_end() for each dec_item_new().
V0.1: Initial release.
</RELEASE_NOTES>
*/

/*
  TODO:
  ~~~~
  * Recognize different MAN ID
  * status register bitmapping
*/

//Decoder GUI
function on_draw_gui_decoder()
{
  //Define decoder configuration GUI
  ScanaStudio.gui_add_ch_selector( "ch_mosi", "MOSI (Master Out) Line", "MOSI" );
	ScanaStudio.gui_add_ch_selector( "ch_miso", "MISO (Slave Out) Line", "MISO" );
	ScanaStudio.gui_add_ch_selector( "ch_clk", "CLOCK Line", "SCLK" );
	ScanaStudio.gui_add_ch_selector( "ch_cs", "Chip Select (Slave select)", "CS" );

  if (ScanaStudio.get_device_channels_count() > 4)
  {
      ScanaStudio.gui_add_new_tab("Quad IO",false);
      ScanaStudio.gui_add_check_box("quad_io","Enable Quad IO SPI",false);
      ScanaStudio.gui_add_ch_selector("ch_io2","IO 2","");
      ScanaStudio.gui_add_ch_selector("ch_io3","IO 3","");
      ScanaStudio.gui_add_info_label("IO0 is the MOSI line, IO1 is the MISO line.\n"
                                    +"IO2 and IO3 lines need to be configured above.\n");
    ScanaStudio.gui_end_tab();
  }
  else
  {
    ScanaStudio.gui_add_hidden_field("quad_io",0);
    ScanaStudio.gui_add_hidden_field("ch_io2",0);
    ScanaStudio.gui_add_hidden_field("ch_io3",0);
  }



  ScanaStudio.gui_add_new_tab("Display format options",false);
  gui_add_format_combo("flash_format_commands","Intruction format");
  gui_add_format_combo("flash_format_address","Address format");
  gui_add_format_combo("flash_format_data","Data format");
  ScanaStudio.gui_end_tab();

  //Add hidden elements for the SPI decoder
  ScanaStudio.gui_add_hidden_field("bit_order",0);
  ScanaStudio.gui_add_hidden_field("cpol",0);
  ScanaStudio.gui_add_hidden_field("cpha",0);
  ScanaStudio.gui_add_hidden_field("nbits",6);
  ScanaStudio.gui_add_hidden_field("cspol",0);
  ScanaStudio.gui_add_hidden_field("format_hex","false");
  ScanaStudio.gui_add_hidden_field("format_ascii","false");
  ScanaStudio.gui_add_hidden_field("format_dec","false");
  ScanaStudio.gui_add_hidden_field("format_bin","false");
  ScanaStudio.gui_add_hidden_field("cspol",0);
  ScanaStudio.gui_add_hidden_field("opt",0);
  ScanaStudio.gui_add_hidden_field("dual_io",1); //Dual IO enabled by default
}

//GUI helper
function gui_add_format_combo(id,caption)
{
  ScanaStudio.gui_add_combo_box(id,caption);
  ScanaStudio.gui_add_item_to_combo_box("HEX",true);
  ScanaStudio.gui_add_item_to_combo_box("Unsigned decimal",false);
  ScanaStudio.gui_add_item_to_combo_box("Binary",false);
  ScanaStudio.gui_add_item_to_combo_box("ASCII",false);
}

//Helper function to read all GUI values and put them in global variables
function read_gui_values()
{
  ch_mosi = ScanaStudio.gui_get_value("ch_mosi");
  ch_miso = ScanaStudio.gui_get_value("ch_miso");
  ch_clk = ScanaStudio.gui_get_value("ch_clk");
  ch_cs = ScanaStudio.gui_get_value("ch_cs");
  ch_io2 = ScanaStudio.gui_get_value("ch_io2");
  ch_io3 = ScanaStudio.gui_get_value("ch_io3");
  quad_io = ScanaStudio.gui_get_value("quad_io");
  flash_format_commands = ScanaStudio.gui_get_value("flash_format_commands");
  flash_format_data = ScanaStudio.gui_get_value("flash_format_data");
  flash_format_address = ScanaStudio.gui_get_value("flash_format_address");
  nbits = ScanaStudio.gui_get_value("nbits");
}
//Constants
var IO_MOSI = 0;
var IO_MISO = 1;
var IO_DUAL = 2;
var IO_QUAD = 3;
var NO_PAYLOAD = -1;

//Global variables
var state_machine;
var cmd_descriptor;
var marker;
var cmd_par_counter;
var parameter_data;
var parameter_start_sample_index;
var word_counter;
var commands = [];
var frame_counter;
var frame,frames;

function on_decode_signals(resume)
{
  var i;
  if (!resume) //If resume == false, it's the first call to this function.
  {
      //initialization code
      state_machine = 0;
      frame_counter = -1;
      sampling_rate = ScanaStudio.get_capture_sample_rate();
      // read GUI values using
      read_gui_values();
      build_commands_db();
  }


  //ScanaStudio.console_info_msg("Running SPI sub decoder...Resume="+resume);

  var spi_items = ScanaStudio.pre_decode("spi.js",resume);

  //ScanaStudio.console_info_msg("SPI sub decoder done, n_items=" + spi_items.length);

  //parse decoded items
  for (i = 0; i < spi_items.length; i++)
  {
    //ScanaStudio.dec_item_new(spi_items[i].channel_index,spi_items[i].start_sample_index,spi_items[i].end_sample_index);
    //ScanaStudio.dec_item_add_content(spi_items[i].content);
    //ScanaStudio.dec_item_end();
    var tmp = spi_items[i].content.split(":");
    if (tmp.length > 0)
    {
      spi_items[i].frame_counter = Number(tmp[0]);
      spi_items[i].content = Number(tmp[1]);
      parse_spi_items(spi_items[i]);
    }
    //ScanaStudio.console_info_msg("Frame="+spi_items[i].frame_counter+", content="+spi_items[i].content);
  }
  //ScanaStudio.console_info_msg("SPI Flash dec done");
}

function parse_spi_items(item)
{
  if (item.frame_counter != frame_counter)
  {
    //At any moment, if a frame is interrupted (CS goes high),
    //then we should reset the state machine
    state_machine = 0;
  }
  //ScanaStudio.console_info_msg("STATE:"+state_machine);
  switch (state_machine) {
    case 0: //Wait for new frame
      if (item.frame_counter != frame_counter)
      {
        frame_counter = item.frame_counter;
        state_machine++;
        //No break is itentionnal
      }
      else{
        break;
      }
    case 1: //wait for MOSI data, trash all other data for now
      if (item.channel_index == ch_mosi)
      {
        cmd_descriptor = fetch_command_description(item.content);
        //ScanaStudio.console_info_msg("New command:" + cmd_descriptor[0].code.toString(16));
        marker = item.end_sample_index;
        cmd_par_counter = 1;
        word_counter = 0;
        parameter_data = 0;
        ScanaStudio.dec_item_new(item.channel_index,item.start_sample_index,item.end_sample_index);
        ScanaStudio.dec_item_add_content(cmd_descriptor[0].long_caption+" ("+ data_to_str(item.content,cmd_descriptor[0].format,8)+")");
        ScanaStudio.dec_item_add_content(cmd_descriptor[0].short_caption+" ("+data_to_str(item.content,cmd_descriptor[0].format,8)+")");
        ScanaStudio.dec_item_add_content(data_to_str(item.content,cmd_descriptor[0].format,8));
        ScanaStudio.dec_item_end();
        if (cmd_descriptor.length > 1) //If there is at least one parameter
        {
            state_machine++;
        }
        else
        {
          state_machine = 0; //Wait for next frame
        }
      }
      break;
    case 2: //wait for command parameters
      //ScanaStudio.console_info_msg("item.start_sample_index="+item.start_sample_index+",marker="+marker+",item.ch="+item.channel_index+"/"+cmd_descriptor[cmd_par_counter].source_channel);
      if ((item.start_sample_index > marker)
          &&(item.channel_index == cmd_descriptor[cmd_par_counter].source_channel))
          {
            marker = item.end_sample_index;
            if (word_counter == 0) parameter_start_sample_index = item.start_sample_index;

            parameter_data = (parameter_data * 256) + item.content;
            //ScanaStudio.console_info_msg("Par:"+ cmd_descriptor[cmd_par_counter].long_caption + ":" + parameter_data.toString(16));

            word_counter++;
            if (word_counter >= cmd_descriptor[cmd_par_counter].len) //We reached the end of that parameter
            {
              if (cmd_descriptor[cmd_par_counter].len < 0)
              {
                  cmd_par_counter--;
              }
              ScanaStudio.dec_item_new(item.channel_index,parameter_start_sample_index,item.end_sample_index);
              ScanaStudio.dec_item_add_content(cmd_descriptor[cmd_par_counter].long_caption   + ": "  + data_to_str(parameter_data,cmd_descriptor[cmd_par_counter].format,cmd_descriptor[cmd_par_counter].len*8));
              ScanaStudio.dec_item_add_content(cmd_descriptor[cmd_par_counter].short_caption  + ": "  + data_to_str(parameter_data,cmd_descriptor[cmd_par_counter].format,cmd_descriptor[cmd_par_counter].len*8));
              ScanaStudio.dec_item_add_content(data_to_str(parameter_data,cmd_descriptor[cmd_par_counter].format,cmd_descriptor[cmd_par_counter].len*8));
              ScanaStudio.dec_item_end();
              cmd_par_counter++;
              if (cmd_par_counter >= cmd_descriptor.length)
              {
                //We reached last parameter
                if (cmd_descriptor.payload_channel != NO_PAYLOAD)
                {
                  state_machine++; //Fetch payload data
                }
                else
                {
                  state_machine = 0;
                }
              }
              else {
                //get ready for next parameter
                word_counter = 0;
                parameter_data = 0;
              }
            }
          }
          break;
    case 3: //Payload
      if ((item.start_sample_index > marker)
          &&(item.channel_index == cmd_descriptor[0].payload_channel))
          {
            marker = item.end_sample_index;
            ScanaStudio.dec_item_new(item.channel_index,item.start_sample_index,item.end_sample_index);
            ScanaStudio.dec_item_add_content(data_to_str(item.content,flash_format_data,8));
            ScanaStudio.dec_item_end();
            //ScanaStudio.console_info_msg("Payload:"+ data_to_str(item.content,flash_format_data,8));
          }
      break;
    default:
  }
}

function data_to_str(data,format,nbits)
{
  switch (format) {
    case 0: //HEx
      return ("0x"+pad(data.toString(16),Math.ceil(nbits/4)));
      break;
    case 1: //unsignd Decimal
      return (""+data.toString(10)+"");
      break;
    case 2: //binary
      return ("0b"+pad(data.toString(2),nbits));
      break;
    case 3: //Ascii
      return (" '" + String.fromCharCode(data) + "'");
      break;
    default:
  }
}

function pad(num_str, size) {
    while (num_str.length < size) num_str = "0" + num_str;
    return num_str;
}

//Function called to generate demo siganls (when no physical device is attached)
function on_build_demo_signals()
{
  //Use the function below to get the number of samples to be built
  var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
  var silence_period = (samples_to_build / (125*ScanaStudio.builder_get_sample_rate()));
  var spi_builder = ScanaStudio.load_builder_object("spi.js");
  read_gui_values();
  build_commands_db();

  spi_builder.config(
    ScanaStudio.gui_get_value("ch_mosi"),
    ScanaStudio.gui_get_value("ch_miso"),
    ScanaStudio.gui_get_value("ch_clk"),
    ScanaStudio.gui_get_value("ch_cs"),
    ScanaStudio.gui_get_value("bit_order"),
    ScanaStudio.gui_get_value("cpol"),
    ScanaStudio.gui_get_value("cpha"),
    ScanaStudio.gui_get_value("nbits"),
    ScanaStudio.gui_get_value("cspol"),
    ScanaStudio.builder_get_sample_rate(),
    ScanaStudio.builder_get_sample_rate()/100  //clock frequency
  );
  spi_builder.config_multi_io(
    ScanaStudio.gui_get_value("ch_mosi"),
    ScanaStudio.gui_get_value("ch_miso"),
    ScanaStudio.gui_get_value("ch_io2"),
    ScanaStudio.gui_get_value("ch_io3"),
    ScanaStudio.gui_get_value("quad_io")
  );

  var random_mosi, random_miso, random_d, random_size, w,instr,p;
  spi_builder.put_silence(10e-6);
  instr = 0;
  while (ScanaStudio.builder_get_samples_acc(ch_clk) < samples_to_build)
  {
    if (ScanaStudio.abort_is_requested())
    {
      break;
    }

    if (instr >= commands.length) instr = 0;
    spi_builder.put_start();
    spi_builder.put_silence(1e-6); //1 us
    spi_builder.put_word(commands[instr][0].code,0);

    //Add parameters
    for (p = 1; p < commands[instr].length; p++)
    {
       //Not supported by device?
      if ((commands[instr][p].io_mode == IO_QUAD) && (!quad_io))
      {
        commands[instr][0].payload_channel = -1; //Ignore any payload for that instruction
        break;
      }
      for (w = 0; w < commands[instr][p].len; w++)
      {
        random_mosi = Math.floor(Math.random()*(Math.pow(2,nbits)));
        random_miso = Math.floor(Math.random()*(Math.pow(2,nbits)));
        switch (commands[instr][p].io_mode) {
          case IO_MOSI:
          case IO_MISO:
            spi_builder.put_word(random_mosi,random_miso);
            break;
          case IO_DUAL:
            spi_builder.put_word_dual(random_mosi);
            break;
          case IO_QUAD:
            spi_builder.put_word_quad(random_mosi);
            break;
          default:
        }
        if (ScanaStudio.builder_get_samples_acc(ch_clk) > samples_to_build) break;
      }
      if (ScanaStudio.builder_get_samples_acc(ch_clk) > samples_to_build) break;
    }

    //Add payload if needed
    if (commands[instr][0].payload_channel >= 0)
    {
      random_size = Math.floor(Math.random()*30) + 1;
      for (w = 0; w < random_size; w++)
      {
        random_mosi = Math.floor(Math.random()*(Math.pow(2,nbits)));
        random_miso = Math.floor(Math.random()*(Math.pow(2,nbits)));
        if (commands[instr][0].payload_mode == IO_QUAD)
        {
          spi_builder.put_word_quad(random_mosi);
        }
        else if (commands[instr][0].payload_mode == IO_DUAL)
        {
          spi_builder.put_word_dual(random_mosi);
        }
        else
        {
          spi_builder.put_word(random_mosi,random_miso);
        }
        if (ScanaStudio.builder_get_samples_acc(ch_clk) > samples_to_build) break;
      }
    }

    spi_builder.put_silence(1e-6); //1 us
    spi_builder.put_stop();
    spi_builder.put_silence(silence_period);

    if (ScanaStudio.abort_is_requested())
    {
      break;
    }
    instr++;
  }

  /*
  //test sequences
  spi_builder.put_silence(10e-6);
  spi_builder.put_start();
  spi_builder.put_word(0x06,0);
  spi_builder.put_stop();
  spi_builder.put_silence(1e-6);

  spi_builder.put_start();
  spi_builder.put_word(0xAB,0);
  spi_builder.put_word(0,0xFF);
  spi_builder.put_word(0,0xFF);
  spi_builder.put_word(0,0xFF);
  spi_builder.put_word(0,0x17);
  spi_builder.put_stop();
  spi_builder.put_silence(1e-6);

  spi_builder.put_start();
  spi_builder.put_word(0x03,0); //Read cmd
  spi_builder.put_word(0xA1,0); //Address
  spi_builder.put_word(0xA2,0);
  spi_builder.put_word(0xA3,0);
  spi_builder.put_word(0,0xD1); //Data
  spi_builder.put_word(0,0xD2);
  spi_builder.put_word(0,0xD3);
  spi_builder.put_word(0,0xD4);
  spi_builder.put_word(0,0xD5);
  spi_builder.put_stop();
  spi_builder.put_silence(1e-6);


  spi_builder.put_start();
  spi_builder.put_word(0x05,0); //Read SR1
  spi_builder.put_word(0,0x92);
  spi_builder.put_word(0,0x93);
  spi_builder.put_word(0,0x34);
  spi_builder.put_word(0,0x95);
  spi_builder.put_stop();
  spi_builder.put_silence(1e-6);

  if (multi_io_mode == 1)
  {
    spi_builder.put_start();
    spi_builder.put_word(0x3B,0); //Read dual out
    spi_builder.put_word(0xA1,0); //Address
    spi_builder.put_word(0xA2,0);
    spi_builder.put_word(0xA3,0);
    spi_builder.put_word_dual(0xFF);
    spi_builder.put_word_dual(0xFF);
    spi_builder.put_word_dual(0xD1);
    spi_builder.put_word_dual(0xD2);
    spi_builder.put_word_dual(0xD3);
    spi_builder.put_word_dual(0xD4);
    spi_builder.put_word_dual(0xD5);
    spi_builder.put_word_dual(0xD6);
    spi_builder.put_stop();
    spi_builder.put_silence(1e-6);

    spi_builder.put_start();
    spi_builder.put_word(0xBB,0); //Read dual I/O
    spi_builder.put_word_dual(0xA1,0); //Address
    spi_builder.put_word_dual(0xA2,0);
    spi_builder.put_word_dual(0xA3,0);
    spi_builder.put_word_dual(0xFF); //dummy
    spi_builder.put_word_dual(0xD1);
    spi_builder.put_word_dual(0xD2);
    spi_builder.put_word_dual(0xD3);
    spi_builder.put_word_dual(0xD4);
    spi_builder.put_word_dual(0xD5);
    spi_builder.put_word_dual(0xD6);
    spi_builder.put_stop();
    spi_builder.put_silence(1e-6);
  }
  else if (multi_io_mode == 2)
  {
    spi_builder.put_start();
    spi_builder.put_word(0x6B,0); //Fast Read Quad I/O
    spi_builder.put_word_quad(0xA1,0); //Address
    spi_builder.put_word_quad(0xA2,0);
    spi_builder.put_word_quad(0xA3,0);
    spi_builder.put_word_quad(0xFF); //dummy
    spi_builder.put_word_quad(0xFF); //dummy
    spi_builder.put_word_quad(0xFF); //dummy
    spi_builder.put_word_quad(0xFF); //dummy
    spi_builder.put_word_quad(0xD1);
    spi_builder.put_word_quad(0xD2);
    spi_builder.put_word_quad(0xD3);
    spi_builder.put_word_quad(0xD4);
    spi_builder.put_word_quad(0xD5);
    spi_builder.put_word_quad(0xD6);
    spi_builder.put_stop();
    spi_builder.put_silence(1e-6);
  } */
}

function fetch_command_description(h)
{
  var i;
  var unknown_transaction = [];
  var unknown_cmd = [];
  unknown_transaction.push(new header_t(0xFF,"?","Unknown Command",NO_PAYLOAD));
  //unknown_cmd.push(transaction);

  for (i = 0; i < commands.length; i++)
  {
    if (commands[i][0].code == h)
    {
      return commands[i];
    }
  }
  return unknown_transaction;
}

function build_commands_db()
{
  //https://www.winbond.com/resource-files/w25m321av_combo_reva%20091317.pdf
  var transaction = [];

  transaction = [];
  transaction.push(new header_t(0x06,"WE","Write Enable",NO_PAYLOAD));
  commands.push(transaction);

  transaction = []; //force new reference and deep copy
  transaction.push(new header_t(0x50,"VSRWE","Volatile Status Register Write Enable",NO_PAYLOAD));
  commands.push(transaction);

  transaction = [];
  transaction.push(new header_t(0x04,"WD","Write Disable",NO_PAYLOAD));
  commands.push(transaction);

  //--------------

  transaction = [];
  transaction.push(new header_t(0xAB,"RES/ID","Release Power-down / ID",NO_PAYLOAD));
  transaction.push(new parameter_t(3,IO_MISO,"Dummy","3 Dummy bytes",flash_format_data));
  transaction.push(new parameter_t(1,IO_MISO,"ID","Device ID",flash_format_data));
  commands.push(transaction);

  transaction = [];
  transaction.push(new header_t(0x90,"MAN ID","Manufacturer / Device ID",NO_PAYLOAD));
  transaction.push(new parameter_t(2,IO_MISO,"Dummy","2 Dummy bytes",flash_format_data));
  transaction.push(new parameter_t(1,IO_MISO,"MAN","Manufacturer ID",flash_format_data));
  transaction.push(new parameter_t(1,IO_MISO,"DEV","Device ID",flash_format_data));
  commands.push(transaction);

  transaction = [];
  transaction.push(new header_t(0x9F,"JID","JEDEC ID",NO_PAYLOAD));
  transaction.push(new parameter_t(1,IO_MISO,"MAN","1 Manufacturer ID byte",flash_format_data));
  transaction.push(new parameter_t(2,IO_MISO,"CAP","1 Capacity ID bytes",flash_format_data));
  commands.push(transaction);

  transaction = [];
  transaction.push(new header_t(0x4B,"UID","Unique ID",NO_PAYLOAD));
  transaction.push(new parameter_t(4,IO_MISO,"Dummy","4 Dummy bytes",flash_format_data));
  transaction.push(new parameter_t(8,IO_MISO,"UID","64-Bit unique serial number",flash_format_data));
  commands.push(transaction);

  //-------------

  transaction = [];
  transaction.push(new header_t(0x03,"RD","Read Data",ch_miso,IO_MOSI));
  transaction.push(new parameter_t(3,IO_MOSI,"A","3 Address bytes",flash_format_address));
  commands.push(transaction);

  transaction = [];
  transaction.push(new header_t(0x0B,"FRD","Fast Read Data",ch_miso,IO_MOSI));
  transaction.push(new parameter_t(3,IO_MOSI,"A","3 Address bytes",flash_format_address));
  transaction.push(new parameter_t(1,IO_MISO,"Dummy","1 Dummy byte",flash_format_data));
  commands.push(transaction);

  //--------------

  transaction = [];
  transaction.push(new header_t(0x02,"PP","Page Program",IO_MOSI));
  transaction.push(new parameter_t(3,IO_MOSI,"A","3 Address bytes",flash_format_address));
  commands.push(transaction);

  //--------------

  transaction = [];
  transaction.push(new header_t(0x20,"4KSE","4KB Sector erase",NO_PAYLOAD));
  transaction.push(new parameter_t(3,IO_MOSI,"A","3 Address bytes",flash_format_address));
  commands.push(transaction);

  transaction = [];
  transaction.push(new header_t(0x52,"32KSE","32KB Sector erase",NO_PAYLOAD));
  transaction.push(new parameter_t(3,IO_MOSI,"A","3 Address bytes",flash_format_address));
  commands.push(transaction);

  transaction = [];
  transaction.push(new header_t(0xD8,"64KSE","64KB Sector erase",NO_PAYLOAD));
  transaction.push(new parameter_t(3,IO_MOSI,"A","3 Address bytes",flash_format_address));
  commands.push(transaction);

  transaction = [];
  transaction.push(new header_t(0xC7,"CE","Chip erase",NO_PAYLOAD));
  commands.push(transaction);

  transaction = [];
  transaction.push(new header_t(0x60,"CE","Chip erase",NO_PAYLOAD));
  commands.push(transaction);

  //------------

  transaction = [];
  transaction.push(new header_t(0x05,"RDSR1","Read status register 1",NO_PAYLOAD));
  transaction.push(new parameter_t(-1,IO_MISO,"SR1","Status register 1",flash_format_data));
  commands.push(transaction);
  transaction = [];
  transaction.push(new header_t(0x35,"RDSR2","Read status register 2",NO_PAYLOAD));
  transaction.push(new parameter_t(-1,IO_MISO,"SR1","Status register 2",flash_format_data));
  commands.push(transaction);
  transaction = [];
  transaction.push(new header_t(0x15,"RDSR3","Read status register 3",NO_PAYLOAD));
  transaction.push(new parameter_t(-1,IO_MISO,"SR1","Status register 3",flash_format_data));
  commands.push(transaction);

  transaction = [];
  transaction.push(new header_t(0x01,"WRSR1","Write status register 1",NO_PAYLOAD));
  transaction.push(new parameter_t(1,IO_MOSI,"SR1","Status register 1",flash_format_data));
  transaction.push(new parameter_t(1,IO_MOSI,"SR1","Status register 2",flash_format_data));
  commands.push(transaction);

  transaction = [];
  transaction.push(new header_t(0x31,"WRSR2","Write status register 2",NO_PAYLOAD));
  transaction.push(new parameter_t(1,IO_MOSI,"SR2","Status register 2",flash_format_data))
  commands.push(transaction);

  transaction = [];
  transaction.push(new header_t(0x31,"WRSR3","Write status register 3",NO_PAYLOAD));
  transaction.push(new parameter_t(1,IO_MOSI,"SR3","Status register 3",flash_format_data))
  commands.push(transaction);

  //----------------

  transaction = [];
  transaction.push(new header_t(0x5A,"RD SFDP","Read SFDP",IO_MISO));
  transaction.push(new parameter_t(3,IO_MOSI,"A","3 Address bytes",flash_format_address));
  transaction.push(new parameter_t(1,IO_MISO,"Dummy","1 Dummy bytes",flash_format_data));
  commands.push(transaction);

  transaction = [];
  transaction.push(new header_t(0x44,"ESR","Erase Security Register",NO_PAYLOAD));
  transaction.push(new parameter_t(3,IO_MOSI,"A","3 Address bytes",flash_format_address));
  commands.push(transaction);

  transaction = [];
  transaction.push(new header_t(0x42,"PSR","Page Security Register",IO_MOSI));
  transaction.push(new parameter_t(3,IO_MOSI,"A","3 Address bytes",flash_format_address));
  commands.push(transaction);

  transaction = [];
  transaction.push(new header_t(0x48,"RSR","Read security register",IO_MISO));
  transaction.push(new parameter_t(3,IO_MOSI,"A","3 Address bytes",flash_format_address));
  transaction.push(new parameter_t(1,IO_MISO,"Dummy","1 Dummy byte",flash_format_address));
  commands.push(transaction);

  //-------------------

  transaction = [];
  transaction.push(new header_t(0x7E,"GBLK","Global block lock",NO_PAYLOAD));
  commands.push(transaction);

  transaction = [];
  transaction.push(new header_t(0x98,"GBUN","Global block unlock",NO_PAYLOAD));
  commands.push(transaction);

  transaction = [];
  transaction.push(new header_t(0x3D,"RBL","Read block lock",NO_PAYLOAD));
  transaction.push(new parameter_t(3,IO_MOSI,"A","3 Address bytes",flash_format_address));
  transaction.push(new parameter_t(1,IO_MISO,"Lock","Lock value",flash_format_address));
  commands.push(transaction);

  transaction = [];
  transaction.push(new header_t(0x36,"IBL","Individual block lock",NO_PAYLOAD));
  transaction.push(new parameter_t(3,IO_MOSI,"A","3 Address bytes",flash_format_address));
  commands.push(transaction);

  transaction = [];
  transaction.push(new header_t(0x36,"IBU","Individual block unlock",NO_PAYLOAD));
  transaction.push(new parameter_t(3,IO_MOSI,"A","3 Address bytes",flash_format_address));
  commands.push(transaction);

  //----------------------
  transaction = [];
  transaction.push(new header_t(0x75,"E/P S","Erase/Program suspend",NO_PAYLOAD));
  commands.push(transaction);

  transaction = [];
  transaction.push(new header_t(0x7A,"E/P R","Erase/Program resume",NO_PAYLOAD));
  commands.push(transaction);

  transaction = [];
  transaction.push(new header_t(0xB9,"PD","Power down",NO_PAYLOAD));
  commands.push(transaction);

  //-------------------------

  transaction = [];
  transaction.push(new header_t(0x66,"ER","Enable reset",NO_PAYLOAD));
  commands.push(transaction);

  transaction = [];
  transaction.push(new header_t(0x99,"RST","Reset device",NO_PAYLOAD));
  commands.push(transaction);

  //------------------- DUAL/QUAD SPI Instructions

  transaction = [];
  transaction.push(new header_t(0x3B,"FR2O","Fast read dual ouput",IO_DUAL));
  transaction.push(new parameter_t(3,IO_MOSI,"A","3 Address bytes",flash_format_address));
  transaction.push(new parameter_t(2,IO_DUAL,"Dummy","2 Dummy bytes",flash_format_data));
  commands.push(transaction);

  transaction = [];
  transaction.push(new header_t(0xBB,"FR2IO","Fast read dual I/O",IO_DUAL));
  transaction.push(new parameter_t(3,IO_DUAL,"A","3 Address bytes",flash_format_address));
  transaction.push(new parameter_t(1,IO_DUAL,"Dummy","1 Dummy byte",flash_format_data));
  commands.push(transaction);

  transaction = [];
  transaction.push(new header_t(0x92,"MD2IO","Manufacturer/Device ID dual I/O",IO_DUAL));
  transaction.push(new parameter_t(3,IO_DUAL,"A","3 Address bytes",flash_format_address));
  transaction.push(new parameter_t(1,IO_DUAL,"Dummy","1 Dummy byte",flash_format_data));
  transaction.push(new parameter_t(1,IO_DUAL,"MFR ID","Manufacturer ID",flash_format_data));
  transaction.push(new parameter_t(1,IO_DUAL,"DEV ID","Device ID",flash_format_data));
  commands.push(transaction);

  transaction = [];
  transaction.push(new header_t(0x32,"4IPP","Quad Input Page Program",IO_QUAD));
  transaction.push(new parameter_t(3,IO_QUAD,"A","3 Address bytes",flash_format_address));
  commands.push(transaction);

  transaction = [];
  transaction.push(new header_t(0x6B,"FR4O","Fast read Quad ouput",IO_QUAD));
  transaction.push(new parameter_t(3,IO_QUAD,"A","3 Address bytes",flash_format_address));
  transaction.push(new parameter_t(4,IO_QUAD,"Dummy","4 Dummy bytes",flash_format_data));
  commands.push(transaction);

  transaction = [];
  transaction.push(new header_t(0x94,"MD4IO","Manufacturer/Device ID quad I/O",IO_QUAD));
  transaction.push(new parameter_t(3,IO_QUAD,"A","3 Address bytes",flash_format_address));
  transaction.push(new parameter_t(3,IO_QUAD,"Dummy","3 Dummy bytes",flash_format_data));
  transaction.push(new parameter_t(1,IO_QUAD,"MFR ID","Manufacturer ID",flash_format_data));
  transaction.push(new parameter_t(1,IO_QUAD,"DEV ID","Device ID",flash_format_data));
  commands.push(transaction);

  transaction = [];
  transaction.push(new header_t(0xEB,"FR4IO","Fast read quad I/O",IO_QUAD));
  transaction.push(new parameter_t(3,IO_QUAD,"A","3 Address bytes",flash_format_address));
  transaction.push(new parameter_t(1,IO_QUAD,"Dummy","3 Dummy bytes",flash_format_data));
  commands.push(transaction);

  transaction = [];
  transaction.push(new header_t(0x77,"SBW","Set burst wrap",IO_QUAD));
  transaction.push(new parameter_t(3,IO_QUAD,"X","3 Dont't care bytes",flash_format_data));
  transaction.push(new parameter_t(1,IO_QUAD,"Wrap","Wrap bits",flash_format_data));
  commands.push(transaction);

}

function header_t(code,sc,lc,pm)
{
  this.code = code;
  this.short_caption = sc;
  this.long_caption = lc;
  this.payload_mode = pm;
  this.format = flash_format_commands;

  switch (pm) {
    case IO_MOSI:
      this.payload_channel = ch_mosi;
      break;
    case IO_MISO:
      this.payload_channel = ch_miso;
      break;
    case IO_DUAL:
      this.payload_channel = ch_clk;
      break;
    case IO_QUAD:
      this.payload_channel = ch_cs;
      break;
    default:
      break;
  }
}

function parameter_t(len,io_mode,sc,lc,fmt)
{
  this.len = len; //Number of bytes
  this.io_mode = io_mode; //0 for default MOSI/MISO, 1 for Dual IO, 2 for Quad IO
  this.long_caption = lc; //Text to describe the data (ex: "Address" or "Dummy")
  this.short_caption = sc;
  this.format = fmt;
  switch (io_mode) {
    case IO_MOSI:
      this.source_channel = ch_mosi;
      break;
    case IO_MISO:
      this.source_channel = ch_miso;
      break;
    case IO_DUAL:
      this.source_channel = ch_clk;
      break;
    case IO_QUAD:
      this.source_channel = ch_cs;
      break;
    default:
      break;
  }

}
