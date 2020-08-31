/* Protocol meta info:
<NAME> DMX-512 </NAME>
<DESCRIPTION>
DMX512 (Digital Multiplex) is a standard for digital communication networks that are commonly used to control stage lighting and effects.
Signals are based on UART.
DMX512-A include RDM improvement that allow bidirectional communication between slaves devices and the master.
</DESCRIPTION>
<VERSION> 0.73 </VERSION>
<AUTHOR_NAME>  Nicolas BASTIT </AUTHOR_NAME>
<AUTHOR_URL> n.bastit@ikalogic.com </AUTHOR_URL>
<COPYRIGHT> Copyright Nicolas BASTIT </COPYRIGHT>
<LICENSE>  This code is distributed under the terms
of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.73: Fixed bug : error during live-mode.
V0.72: Added discovery response decoding.
V0.71: Fixed last decoded frame.
V0.70: Added RDM capability (DMX512-A normative reference).
V0.61: Updated description.
V0.6: Updated packet view color palette
V0.5: Added hex view
V0.2: Added dec_item_end() for each dec_item_new().
V0.1: Initial release.
</RELEASE_NOTES>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
*/

function on_draw_gui_decoder()
{
    ScanaStudio.gui_add_ch_selector("ch","Channel to decode","DMX-512");

    //for the next release
    // ScanaStudio.gui_add_new_selectable_containers_group("select_decoder_option","Select decoder option");
    //     ScanaStudio.gui_add_new_container("Decode and display all the data", true);
    //         ScanaStudio.gui_add_info_label("text");
    //     ScanaStudio.gui_end_container();
    //     ScanaStudio.gui_add_new_container("Select wich channels to decode", false);
    //         for(var i=0; i<NBR_MAX_CHANNEL; i++)
    //         {
    //             ScanaStudio.gui_add_check_box("chk" + (i+1), "Channel " + (i+1), false);
    //         }
    //     ScanaStudio.gui_end_container();
    // ScanaStudio.gui_end_selectable_containers_group();

    ScanaStudio.gui_add_hidden_field("baud",250000);

    ScanaStudio.gui_add_hidden_field("format_hex","HEX",true);
    ScanaStudio.gui_add_hidden_field("format_ascii","ASCII",false);
    ScanaStudio.gui_add_hidden_field("format_dec","Unsigned decimal",false);
    ScanaStudio.gui_add_hidden_field("format_bin","Binary",false);
    ScanaStudio.gui_add_hidden_field("nbits",3);
    ScanaStudio.gui_add_hidden_field("parity",0);
    ScanaStudio.gui_add_hidden_field("stop", 2);
    ScanaStudio.gui_add_hidden_field("order", 0);
    ScanaStudio.gui_add_hidden_field("invert", 0);
    ScanaStudio.gui_add_hidden_field("hexview_endianness", 0);
}

function on_eval_gui_decoder()
{
    //for the next release
    // if( Number(ScanaStudio.gui_get_value("select_decoder_option") ) )
    // {
    //     var at_least_one_selected = false;
    //     for(var i=0; i<NBR_MAX_CHANNEL; i++)
    //     {
    //         if( Number(ScanaStudio.gui_get_value("chk" + (i+1))) )
    //         {
    //             at_least_one_selected = true;
    //             break;
    //         }
    //     }
    //
    //     if(!at_least_one_selected)
    //     {
    //         return "Select at least one channel to decode";
    //     }
    // }

    if (Number(ScanaStudio.gui_get_value("baud")*8) >= (ScanaStudio.get_capture_sample_rate()))
    {
        return "Sampling rate is too low compared to DMX-512 baudrate (250kb/s). Sampling rate should be at least 8 times greater than the bauderate.";
    }

    return "";
}

var channel;
var trs;
var last_trs;
var trame = [];
var ignore_item = false;
var trame_started;
var trame_ended;
var trame_type = 0;
var rdm_state;
var rdm_cnt_i;
var sample_start_pkt;
var rdm_pdl;
var rdm_pdl_cnt;
var rdm_msg_len;
var rdm_cnt_slots;
var rdm_chksum;
var uart_items = [];
var last_i;
//for the next release
// var select_decoder;
// var list_channel = [];
// var i_ch;

//time constant in s from http://stsserd.free.fr/Cours_sts2/Logique/Pr%E9sentation%20DMX512.pdf
const   CONST_t_break_min       = 87e-6,
        CONST_t_break_type      = 88e-6,
        CONST_t_break_max       = 1,
        CONST_t_btw_break       = 1.2e-3,
        CONST_t_MAB_min         = 7e-6, //MAB = Mark After Break
        CONST_t_MAB_type        = 8e-6,
        CONST_t_MAB_max         = 1,
        CONST_time_tolerance    = 0.02, //2%
        CONST_t_bit             = 4e-6,
        CONST_t_MTBF_min        = 0, //MTBF : Mark Time Between Frame
        CONST_t_MTBF_max        = 1,
        CONST_t_MTBP_min        = 0, //MTBP : Mark Time Between Packet
        CONST_t_MTBP_max        = 1;

const   ENUM_STATE_BREAK    = 0,
        ENUM_STATE_MAB      = 1,
        ENUM_STATE_START    = 2,
        ENUM_STATE_MTBF     = 3,
        ENUM_STATE_DATA     = 4;

const   TRAME_DMX = 0,
        TRAME_RDM = 1,
        TRAME_DISCO = 2;

// RDM doc :
// https://getdlight.com/media/kunena/attachments/42/ANSI_E1-20_2010.pdf
const   RDM_STATE_SUB_START         = 0,
        RDM_STATE_MSG_LEN           = 1,
        RDM_STATE_DESTINATION_UID   = 2,
        RDM_STATE_SOURCE_UID        = 3,
        RDM_STATE_TRANSACTION_NUM   = 4,
        RDM_STATE_PORT_ID           = 5,
        RDM_STATE_MSG_COUNT         = 6,
        RDM_STATE_SUB_DEVICE        = 7,
        RDM_STATE_COMMAND_CLASS     = 8,
        RDM_STATE_PARAM_ID          = 9,
        RDM_STATE_PARAM_DATA_LEN    = 10,
        RDM_STATE_PARAM_DATA        = 11,
        RDM_STATE_CHECKSUM          = 12,
        RDM_STATE_START             = 0xFF;

const   DISCO_STATE_PREAMBLE        = 0,
        DISCO_STATE_SEP_PREAMBLE    = 1,
        DISCO_STATE_MAN_ID          = 2,
        DISCO_STATE_DEV_ID          = 3,
        DISCO_STATE_CHECKSUM        = 4;

//for the next release
// const NBR_MAX_CHANNEL = 30;//512;

function reload_dec_gui_values()
{
    channel = Number(ScanaStudio.gui_get_value("ch"));

    //for the next release
    // select_decoder = Number(ScanaStudio.gui_get_value("select_decoder_option") );
    // list_channel = [];
    // if(select_decoder == 1)
    // {
    //     for(var i=0; i<NBR_MAX_CHANNEL; i++)
    //     {
    //         if( Number(ScanaStudio.gui_get_value("chk" + (i+1))) )
    //         {
    //             list_channel.push(i+1);
    //         }
    //     }
    // }
}

function on_decode_signals (resume)
{
    if (!resume)
    {
        //initialization code
        reload_dec_gui_values();
        trame = [];
        trame_started = false;
        trame_ended = false;
        trame_type = TRAME_DMX;
        rdm_state = RDM_STATE_START;
        ScanaStudio.trs_reset(channel);
        trs = ScanaStudio.trs_get_next(channel);
        last_trs = trs;
        ignore_item = false;
        uart_items = [];
        last_i = 0;
    }

    uart_items = ScanaStudio.pre_decode("uart.js",resume);
    var sample_rate = ScanaStudio.get_capture_sample_rate();

    for (var j = uart_items.length - 1; j >= 0; j--)
    {
        if( (uart_items[j].content == "Start") ||
            (uart_items[j].content == "Parity OK") ||
            (uart_items[j].content == "Parity ERROR") ||
            (uart_items[j].content == "Stop") ||
            (uart_items[j].content == "Stop bit Missing!") )
        {
            uart_items.splice(j,1);
        }
    }

    for (var j=0; (j<uart_items.length) && (!ScanaStudio.abort_is_requested()); j++)
    {
        ignore_item = false;

        while ((last_trs.sample_index < uart_items[j].start_sample_index) && (ScanaStudio.trs_is_not_last(channel)) && (!ScanaStudio.abort_is_requested()))
        {
            if ((trs.value == 1)  // start condition is BREAK + MAB
                && (trs.sample_index - last_trs.sample_index >= sample_rate*CONST_t_break_min)
                && (trs.sample_index - last_trs.sample_index <= sample_rate*CONST_t_break_max))
            {
                if(trame_started)//searching for end condition
                {
                    trame_ended = true;
                    ignore_item = true;
                    j--;
                    break;
                }
                else
                {
                    if(ScanaStudio.trs_is_not_last(channel))
                    {
                        last_trs = trs;
                        trs = ScanaStudio.trs_get_next(channel);
                    }
                    else
                    {
                        break;
                    }

                    if( (trs.value==0)
                        && (trs.sample_index - last_trs.sample_index >= sample_rate*CONST_t_MAB_min)
                        && (trs.sample_index - last_trs.sample_index <= sample_rate*CONST_t_MAB_max) )
                    {
                        if(!trame_started)//if frame is not started
                        {
                            trame = [];
                            last_i = 0;
                            trame_started = true;
                            ignore_item = true;
                            break;
                        }
                    }
                    else
                    {
                        //WRONG MAB
                    }
                }
            }
            else
            {
                last_trs = trs;
                trs = ScanaStudio.trs_get_next(channel);
            }
        }//end while searching for start condition

        if(j==uart_items.length-1)
        {
            // if(!ScanaStudio.trs_is_not_last(channel))
            {
                if(trame_started && (trame.length != 0))//searching for end condition
                {
                    // if( (trs.value==0) && (trs.sample_index - last_trs.sample_index >= sample_rate*CONST_t_break_type) )
                    if(uart_items[j].end_sample_index + (uart_items[j].end_sample_index -uart_items[j].start_sample_index) < ScanaStudio.get_available_samples(channel))
                    {
                        trame_ended = true;
                        // ignore_item = true;
                    }
                }
            }
        }

        if(trame_started)//if frame has already started
        {
            if(!ignore_item)
            {
                trame.push(uart_items[j]);
            }

            if(trame_ended && (trame.length != 0))//decode trame
            {
                trame_ended = false;
                var i;
                for (i=last_i; (i<trame.length) && (!ScanaStudio.abort_is_requested()); i++)
                {
                    if (i==0)
                    {
                        if ((trame[i].content == "0x00"))//start DMX standard frame
                        {
                            trame_type = TRAME_DMX;
                            ScanaStudio.packet_view_add_packet( true,
                                                                channel,
                                                                trame[0].start_sample_index,
                                                                trame[trame.length-1].end_sample_index,
                                                                "DMX-512",
                                                                "CH" + (channel + 1),
                                                                ScanaStudio.get_channel_color(channel),
                                                                ScanaStudio.get_channel_color(channel));

                            ScanaStudio.dec_item_new(channel, trame[i].start_sample_index, trame[i].end_sample_index);
                            ScanaStudio.dec_item_add_content("Start");
                            ScanaStudio.dec_item_end();

                            //for the next release
                            // i_ch = 0;

                            ScanaStudio.packet_view_add_packet(
                                false,
                                channel,
                                trame[i].start_sample_index,
                                trame[i].end_sample_index,
                                "Start",
                                "Ok",
                                ScanaStudio.PacketColors.Wrap.Title,
                                ScanaStudio.PacketColors.Wrap.Content);
                        }
                        else if ((trame[i].content == "0xcc")) //Start a RDM frame
                        {
                            trame_type = TRAME_RDM;
                            rdm_cnt_slots = 0;
                            rdm_cnt_i = 0;
                            rdm_chksum = 0xcc;
                            rdm_state = RDM_STATE_SUB_START;
                            ScanaStudio.packet_view_add_packet( true,
                                                                channel,
                                                                trame[0].start_sample_index,
                                                                trame[trame.length-1].end_sample_index,
                                                                "RDM",
                                                                "CH" + (channel + 1),
                                                                ScanaStudio.get_channel_color(channel),
                                                                ScanaStudio.get_channel_color(channel));

                            ScanaStudio.dec_item_new(channel, trame[i].start_sample_index, trame[i].end_sample_index);
                            ScanaStudio.dec_item_add_content("Start RDM");
                            ScanaStudio.dec_item_add_content("SC_RDM");
                            ScanaStudio.dec_item_end();

                            //for the next release
                            // i_ch = 0;

                            ScanaStudio.packet_view_add_packet(
                                false,
                                channel,
                                trame[i].start_sample_index,
                                trame[i].end_sample_index,
                                "Start",
                                "Ok",
                                ScanaStudio.PacketColors.Wrap.Title,
                                ScanaStudio.PacketColors.Wrap.Content);
                        }
                        else if ((trame[i].content == "0xfe")) //Start a Discovery frame
                        {
                            trame_type = TRAME_DISCO;
                            rdm_cnt_slots = 0;
                            rdm_cnt_i = 0;
                            rdm_chksum = 0;
                            rdm_state = DISCO_STATE_PREAMBLE;
                            sample_start_pkt = trame[0].start_sample_index
                            ScanaStudio.packet_view_add_packet( true,
                                                                channel,
                                                                trame[0].start_sample_index,
                                                                trame[trame.length-1].end_sample_index,
                                                                "Discovery answer",
                                                                "CH" + (channel + 1),
                                                                ScanaStudio.get_channel_color(channel),
                                                                ScanaStudio.get_channel_color(channel));
                        }
                        else //wrong start but still decode following byte
                        {
                            trame_started = false;
                            ScanaStudio.dec_item_new(channel, trame[i].start_sample_index, trame[i].end_sample_index);
                            ScanaStudio.dec_item_add_content( "WRONG Start " + trame[i].content);
                            ScanaStudio.dec_item_add_content( trame[i].content);
                            ScanaStudio.dec_item_emphasize_error();
                            ScanaStudio.dec_item_end();

                            ScanaStudio.packet_view_add_packet(
                                false,
                                channel,
                                trame[i].start_sample_index,
                                trame[i].end_sample_index,
                                "Start",
                                "Wrong",
                                ScanaStudio.PacketColors.Error.Title,
                                ScanaStudio.PacketColors.Error.Content);
                        }
                    }
                    else // data bytes
                    {
                        if(trame_type == TRAME_RDM) // RDM frame
                        {
                            switch(rdm_state)
                            {
                                case RDM_STATE_SUB_START:
                                {
                                    ScanaStudio.packet_view_add_packet( false,
                                                                        channel,
                                                                        trame[i].start_sample_index,
                                                                        trame[i].end_sample_index,
                                                                        "sub-Start Code",
                                                                        trame[i].content,
                                                                        ScanaStudio.PacketColors.Preamble.Title,
                                                                        ScanaStudio.PacketColors.Preamble.Content);

                                    ScanaStudio.dec_item_new(channel, trame[i].start_sample_index, trame[i].end_sample_index);
                                    ScanaStudio.dec_item_add_content("sub-Start Code : " + trame[i].content);
                                    ScanaStudio.dec_item_add_content("sSC : " + trame[i].content);
                                    ScanaStudio.dec_item_add_content(trame[i].content);
                                    ScanaStudio.dec_item_end();
                                    rdm_cnt_slots++;
                                    rdm_chksum += parseInt(trame[i].content,16);
                                    rdm_state = RDM_STATE_MSG_LEN;
                                    break;
                                }//end case RDM_STATE_SUB_START

                                case RDM_STATE_MSG_LEN:
                                {
                                    ScanaStudio.packet_view_add_packet( false,
                                                                        channel,
                                                                        trame[i].start_sample_index,
                                                                        trame[i].end_sample_index,
                                                                        "MSG Len",
                                                                        trame[i].content,
                                                                        ScanaStudio.PacketColors.Head.Title,
                                                                        ScanaStudio.PacketColors.Head.Content);

                                    ScanaStudio.dec_item_new(channel, trame[i].start_sample_index, trame[i].end_sample_index);
                                    ScanaStudio.dec_item_add_content("Message Length : " + trame[i].content);
                                    ScanaStudio.dec_item_add_content("MSG Len : " + trame[i].content);
                                    ScanaStudio.dec_item_add_content(trame[i].content);
                                    ScanaStudio.dec_item_end();
                                    rdm_msg_len = parseInt(trame[i].content,16);
                                    rdm_state = RDM_STATE_DESTINATION_UID;
                                    rdm_cnt_i = 0;
                                    tmp_byte_value = "0x";
                                    sample_start_pkt = 0;
                                    rdm_chksum += parseInt(trame[i].content,16);
                                    rdm_cnt_slots++;
                                    break;
                                }//end case RDM_STATE_MSG_LEN

                                case RDM_STATE_DESTINATION_UID:
                                {
                                    tmp_byte_value += pad(parseInt( trame[i].content, 16).toString(16),2);
                                    rdm_chksum += parseInt(trame[i].content,16);

                                    rdm_cnt_i++;
                                    rdm_cnt_slots++;
                                    if(rdm_cnt_i>=6)
                                    {
                                        ScanaStudio.packet_view_add_packet( false,
                                                                            channel,
                                                                            sample_start_pkt,
                                                                            trame[i].end_sample_index,
                                                                            "Dest UID",
                                                                            tmp_byte_value,
                                                                            ScanaStudio.PacketColors.Data.Title,
                                                                            ScanaStudio.PacketColors.Data.Content);

                                        ScanaStudio.dec_item_new(channel, sample_start_pkt, trame[i].end_sample_index);
                                        ScanaStudio.dec_item_add_content("Destination UID : " + tmp_byte_value);
                                        ScanaStudio.dec_item_add_content("Dest UID : " + tmp_byte_value);
                                        ScanaStudio.dec_item_add_content(tmp_byte_value);
                                        ScanaStudio.dec_item_end();
                                        rdm_state = RDM_STATE_SOURCE_UID;
                                        rdm_cnt_i = 0;
                                        tmp_byte_value = "0x";
                                        sample_start_pkt = 0;
                                    }
                                    else if(rdm_cnt_i==1)
                                    {
                                        sample_start_pkt = trame[i].start_sample_index;
                                    }

                                    break;
                                }//end case RDM_STATE_DESTINATION_UID

                                case RDM_STATE_SOURCE_UID:
                                {
                                    tmp_byte_value += pad(parseInt( trame[i].content, 16).toString(16),2);
                                    rdm_chksum += parseInt(trame[i].content,16);

                                    rdm_cnt_i++;
                                    rdm_cnt_slots++;
                                    if(rdm_cnt_i>=6)
                                    {
                                        ScanaStudio.packet_view_add_packet( false,
                                                                            channel,
                                                                            sample_start_pkt,
                                                                            trame[i].end_sample_index,
                                                                            "Src UID",
                                                                            tmp_byte_value,
                                                                            ScanaStudio.PacketColors.Data.Title,
                                                                            ScanaStudio.PacketColors.Data.Content);

                                        ScanaStudio.dec_item_new(channel, sample_start_pkt, trame[i].end_sample_index);
                                        ScanaStudio.dec_item_add_content("Source UID : " + tmp_byte_value);
                                        ScanaStudio.dec_item_add_content("Src UID : " + tmp_byte_value);
                                        ScanaStudio.dec_item_add_content(tmp_byte_value);
                                        ScanaStudio.dec_item_end();
                                        rdm_state = RDM_STATE_TRANSACTION_NUM;
                                        rdm_cnt_i = 0;
                                        tmp_byte_value = "0x";
                                        sample_start_pkt = 0;
                                    }
                                    else if(rdm_cnt_i==1)
                                    {
                                        sample_start_pkt = trame[i].start_sample_index;
                                    }

                                    break;
                                }//end case RDM_STATE_SOURCE_UID

                                case RDM_STATE_TRANSACTION_NUM:
                                {
                                    ScanaStudio.packet_view_add_packet( false,
                                                                        channel,
                                                                        trame[i].start_sample_index,
                                                                        trame[i].end_sample_index,
                                                                        "Transaction Num",
                                                                        trame[i].content,
                                                                        ScanaStudio.PacketColors.Head.Title,
                                                                        ScanaStudio.PacketColors.Head.Content);

                                    ScanaStudio.dec_item_new(channel, trame[i].start_sample_index, trame[i].end_sample_index);
                                    ScanaStudio.dec_item_add_content("Transaction Num : " + trame[i].content);
                                    ScanaStudio.dec_item_add_content("TN : " + trame[i].content);
                                    ScanaStudio.dec_item_add_content(trame[i].content);
                                    ScanaStudio.dec_item_end();
                                    rdm_cnt_slots++;
                                    rdm_chksum += parseInt(trame[i].content,16);
                                    rdm_state = RDM_STATE_PORT_ID;
                                    break;
                                }//end case RDM_STATE_TRANSACTION_NUM

                                case RDM_STATE_PORT_ID:
                                {
                                    var txt;
                                    switch(parseInt(trame[i].content,16))
                                    {
                                        case 0x00:
                                            txt = "RESPONSE_TYPE_ACK";
                                            break;
                                        case 0x01:
                                            txt = "RESPONSE_TYPE_ACK_TIMER";
                                            break;
                                        case 0x02:
                                            txt = "RESPONSE_TYPE_NACK_REASON";
                                            break;
                                        case 0x03:
                                            txt = "RESPONSE_TYPE_ACK_OVERFLOW";
                                            break;
                                        default:
                                            txt = "UNKNOWN_RESPONSE_TYPE";
                                    }

                                    ScanaStudio.packet_view_add_packet( false,
                                                                        channel,
                                                                        trame[i].start_sample_index,
                                                                        trame[i].end_sample_index,
                                                                        "Port ID/Resp type",
                                                                        trame[i].content,
                                                                        ScanaStudio.PacketColors.Wrap.Title,
                                                                        ScanaStudio.PacketColors.Wrap.Content);

                                    ScanaStudio.dec_item_new(channel, trame[i].start_sample_index, trame[i].end_sample_index);
                                    ScanaStudio.dec_item_add_content("Port ID/Resp type : " + trame[i].content);
                                    ScanaStudio.dec_item_add_content("PortID : " + trame[i].content);
                                    ScanaStudio.dec_item_add_content(trame[i].content);
                                    ScanaStudio.dec_item_end();
                                    rdm_cnt_slots++;
                                    rdm_chksum += parseInt(trame[i].content,16);
                                    rdm_state = RDM_STATE_MSG_COUNT;
                                    break;
                                }//end case RDM_STATE_PORT_ID

                                case RDM_STATE_MSG_COUNT:
                                {
                                    ScanaStudio.packet_view_add_packet( false,
                                                                        channel,
                                                                        trame[i].start_sample_index,
                                                                        trame[i].end_sample_index,
                                                                        "Message cnt",
                                                                        trame[i].content,
                                                                        ScanaStudio.PacketColors.Head.Title,
                                                                        ScanaStudio.PacketColors.Head.Content);

                                    ScanaStudio.dec_item_new(channel, trame[i].start_sample_index, trame[i].end_sample_index);
                                    ScanaStudio.dec_item_add_content("Message Count : " + trame[i].content);
                                    ScanaStudio.dec_item_add_content("MSG CNT : " + trame[i].content);
                                    ScanaStudio.dec_item_add_content(trame[i].content);
                                    ScanaStudio.dec_item_end();
                                    rdm_state = RDM_STATE_SUB_DEVICE;
                                    rdm_cnt_i = 0;
                                    tmp_byte_value = "0x";
                                    rdm_cnt_slots++;
                                    rdm_chksum += parseInt(trame[i].content,16);
                                    sample_start_pkt = 0;
                                    break;
                                }//end case RDM_STATE_MSG_COUNT

                                case RDM_STATE_SUB_DEVICE:
                                {
                                    tmp_byte_value += pad(parseInt( trame[i].content, 16).toString(16),2);
                                    rdm_chksum += parseInt(trame[i].content,16);

                                    rdm_cnt_i++;
                                    rdm_cnt_slots++;
                                    if(rdm_cnt_i>=2)
                                    {
                                        ScanaStudio.packet_view_add_packet( false,
                                                                            channel,
                                                                            sample_start_pkt,
                                                                            trame[i].end_sample_index,
                                                                            "subDevice",
                                                                            tmp_byte_value,
                                                                            ScanaStudio.PacketColors.Preamble.Title,
                                                                            ScanaStudio.PacketColors.Preamble.Content);

                                        ScanaStudio.dec_item_new(channel, sample_start_pkt, trame[i].end_sample_index);
                                        ScanaStudio.dec_item_add_content("subDevice : " + tmp_byte_value);
                                        ScanaStudio.dec_item_add_content("sDev : " + tmp_byte_value);
                                        ScanaStudio.dec_item_add_content(tmp_byte_value);
                                        ScanaStudio.dec_item_end();
                                        rdm_state = RDM_STATE_COMMAND_CLASS;
                                        rdm_cnt_i = 0;
                                        tmp_byte_value = "0x";
                                        sample_start_pkt = 0;
                                    }
                                    else if(rdm_cnt_i==1)
                                    {
                                        sample_start_pkt = trame[i].start_sample_index;
                                    }

                                    break;
                                }//end case RDM_STATE_SUB_DEVICE

                                case RDM_STATE_COMMAND_CLASS:
                                {
                                    var txt;
                                    ScanaStudio.dec_item_new(channel, trame[i].start_sample_index, trame[i].end_sample_index);
                                    switch(parseInt(trame[i].content,16))
                                    {
                                        case 0x10:
                                            txt = "DISCOVERY_COMMAND";
                                            break;
                                        case 0x11:
                                            txt = "DISCOVERY_COMMAND_RESPONSE";
                                            break;
                                        case 0x20:
                                            txt = "GET_COMMAND";
                                            break;
                                        case 0x21:
                                            txt = "GET_COMMAND_RESPONSE";
                                            break;
                                        case 0x30:
                                            txt = "SET_COMMAND";
                                            break;
                                        case 0x31:
                                            txt = "SET_COMMAND_RESPONSE";
                                            break;
                                        default:
                                            txt = "";
                                            break;
                                    }
                                    ScanaStudio.packet_view_add_packet( false,
                                                                        channel,
                                                                        trame[i].start_sample_index,
                                                                        trame[i].end_sample_index,
                                                                        "Command Class",
                                                                        txt,
                                                                        ScanaStudio.PacketColors.Misc.Title,
                                                                        ScanaStudio.PacketColors.Misc.Content);

                                    ScanaStudio.dec_item_add_content("Command Class : " + txt + " (" + trame[i].content + ")");
                                    ScanaStudio.dec_item_add_content("Command Class : " + trame[i].content);
                                    ScanaStudio.dec_item_add_content("CC : " + trame[i].content);
                                    ScanaStudio.dec_item_add_content(trame[i].content);
                                    ScanaStudio.dec_item_end();
                                    rdm_cnt_slots++;
                                    rdm_cnt_i = 0;
                                    tmp_byte_value = "0x";
                                    rdm_chksum += parseInt(trame[i].content,16);
                                    rdm_state = RDM_STATE_PARAM_ID;
                                    break;
                                }//end case RDM_STATE_COMMAND_CLASS

                                case RDM_STATE_PARAM_ID:
                                {
                                    tmp_byte_value += pad(parseInt( trame[i].content, 16).toString(16),2);
                                    rdm_chksum += parseInt(trame[i].content,16);

                                    rdm_cnt_slots++;
                                    rdm_cnt_i++;
                                    if(rdm_cnt_i>=2)
                                    {
                                        var txt;
                                        switch(parseInt(trame[i].content,16))
                                        {
                                            case 0x0001:
                                                txt = "DISC_UNIQUE_BRANCH";
                                                break;
                                            case 0x0002:
                                                txt = "DISC_MUTE";
                                                break;
                                            case 0x0003:
                                                txt = "DISC_UN_MUTE";
                                                break;
                                            case 0x0010:
                                                txt = "PROXIED_DEVICES";
                                                break;
                                            case 0x0011:
                                                txt = "PROXIED_DEVICE_COUNT";
                                                break;
                                            case 0x0015:
                                                txt = "COMMS_STATUS";
                                                break;
                                            case 0x0020:
                                                txt = "QUEUED_MESSAGE";
                                                break;
                                            case 0x0030:
                                                txt = "STATUS_MESSAGES";
                                                break;
                                            case 0x0031:
                                                txt = "STATUS_ID_DESCRIPTION";
                                                break;
                                            case 0x0032:
                                                txt = "CLEAR_STATUS_ID";
                                                break;
                                            case 0x0033:
                                                txt = "SUB_DEVICE_STATUS_REPORT_THRESHOLD";
                                                break;
                                            case 0x0050:
                                                txt = "SUPPORTED_PARAMETERS";
                                                break;
                                            case 0x0051:
                                                txt = "PARAMETER_DESCRIPTION";
                                                break;
                                            case 0x0060:
                                                txt = "DEVICE_INFO";
                                                break;
                                            case 0x0070:
                                                txt = "PRODUCT_DETAIL_ID_LIST";
                                                break;
                                            case 0x0080:
                                                txt = "DEVICE_MODEL_DESCRIPTION";
                                                break;
                                            case 0x0081:
                                                txt = "MANUFACTURER_LABEL";
                                                break;
                                            case 0x0082:
                                                txt = "DEVICE_LABEL";
                                                break;
                                            case 0x0090:
                                                txt = "FACTORY_DEFAULTS";
                                                break;
                                            case 0x00A0:
                                                txt = "LANGUAGE_CAPABILITIES";
                                                break;
                                            case 0x00B0:
                                                txt = "LANGUAGE";
                                                break;
                                            case 0x00C0:
                                                txt = "SOFTWARE_VERSION_LABEL";
                                                break;
                                            case 0x00C1:
                                                txt = "BOOT_SOFTWARE_VERSION_ID";
                                                break;
                                            case 0x00C2:
                                                txt = "BOOT_SOFTWARE_VERSION_LABEL";
                                                break;
                                            case 0x00E0:
                                                txt = "DMX_PERSONALITY";
                                                break;
                                            case 0x00E1:
                                                txt = "DMX_PERSONALITY_DESCRIPTION";
                                                break;
                                            case 0x00F0:
                                                txt = "DMX_START_ADDRESS";
                                                break;
                                            case 0x0120:
                                                txt = "SLOT_INFO";
                                                break;
                                            case 0x0121:
                                                txt = "SLOT_DESCRIPTION";
                                                break;
                                            case 0x0122:
                                                txt = "DEFAULT_SLOT_VALUE";
                                                break;
                                            case 0x0200:
                                                txt = "SENSOR_DEFINITION";
                                                break;
                                            case 0x0201:
                                                txt = "SENSOR_VALUE";
                                                break;
                                            case 0x0202:
                                                txt = "RECORD_SENSORS";
                                                break;
                                            case 0x0400:
                                                txt = "DEVICE_HOURS";
                                                break;
                                            case 0x0401:
                                                txt = "LAMP_HOURS";
                                                break;
                                            case 0x0402:
                                                txt = "LAMP_STRIKES";
                                                break;
                                            case 0x0403:
                                                txt = "LAMP_STATE";
                                                break;
                                            case 0x0404:
                                                txt = "LAMP_ON_MODE";
                                                break;
                                            case 0x0405:
                                                txt = "DEVICE_POWER_CYCLES";
                                                break;
                                            case 0x0500:
                                                txt = "DISPLAY_INVERT";
                                                break;
                                            case 0x0501:
                                                txt = "DISPLAY_LEVEL";
                                                break;
                                            case 0x0600:
                                                txt = "PAN_INVERT";
                                                break;
                                            case 0x0601:
                                                txt = "TILT_INVERT";
                                                break;
                                            case 0x0602:
                                                txt = "PAN_TILT_SWAP";
                                                break;
                                            case 0x0603:
                                                txt = "REAL_TIME_CLOCK";
                                                break;
                                            case 0x1000:
                                                txt = "IDENTIFY_DEVICE";
                                                break;
                                            case 0x1001:
                                                txt = "RESET_DEVICE";
                                                break;
                                            case 0x1010:
                                                txt = "POWER_STATE";
                                                break;
                                            case 0x1020:
                                                txt = "PERFORM_SELFTEST";
                                                break;
                                            case 0x1021:
                                                txt = "SELF_TEST_DESCRIPTION";
                                                break;
                                            case 0x1030:
                                                txt = "CAPTURE_PRESET";
                                                break;
                                            case 0x1031:
                                                txt = "PRESET_PLAYBACK";
                                                break;
                                            default :
                                                txt = "UNKNOWN_PARAM_ID";
                                                break;
                                        }

                                        ScanaStudio.packet_view_add_packet( false,
                                                                            channel,
                                                                            sample_start_pkt,
                                                                            trame[i].end_sample_index,
                                                                            "Parameter ID",
                                                                            tmp_byte_value,
                                                                            ScanaStudio.PacketColors.Preamble.Title,
                                                                            ScanaStudio.PacketColors.Preamble.Content);

                                        ScanaStudio.dec_item_new(channel, sample_start_pkt, trame[i].end_sample_index);
                                        ScanaStudio.dec_item_add_content("Parameter ID : " + txt + " " + tmp_byte_value);
                                        ScanaStudio.dec_item_add_content("Parameter ID : " + tmp_byte_value);
                                        ScanaStudio.dec_item_add_content("PID : " + tmp_byte_value);
                                        ScanaStudio.dec_item_add_content(tmp_byte_value);
                                        ScanaStudio.dec_item_end();
                                        rdm_state = RDM_STATE_PARAM_DATA_LEN;
                                        rdm_cnt_i = 0;
                                        tmp_byte_value = "0x";
                                        sample_start_pkt = 0;
                                    }
                                    else if(rdm_cnt_i==1)
                                    {
                                        sample_start_pkt = trame[i].start_sample_index;
                                    }

                                    break;
                                }//end case RDM_STATE_PARAM_ID

                                case RDM_STATE_PARAM_DATA_LEN:
                                {
                                    ScanaStudio.packet_view_add_packet( false,
                                                                        channel,
                                                                        trame[i].start_sample_index,
                                                                        trame[i].end_sample_index,
                                                                        "Param Data Len",
                                                                        trame[i].content,
                                                                        ScanaStudio.PacketColors.Head.Title,
                                                                        ScanaStudio.PacketColors.Head.Content);

                                    ScanaStudio.dec_item_new(channel, trame[i].start_sample_index, trame[i].end_sample_index);
                                    ScanaStudio.dec_item_add_content("Param Data Len : " + trame[i].content);
                                    ScanaStudio.dec_item_add_content("PDL : " + trame[i].content);
                                    ScanaStudio.dec_item_add_content(trame[i].content);
                                    ScanaStudio.dec_item_end();
                                    rdm_cnt_slots++;
                                    rdm_pdl = parseInt(trame[i].content,16);
                                    rdm_pdl_cnt = 0;
                                    rdm_chksum += parseInt(trame[i].content,16);
                                    if(rdm_pdl != 0)
                                    {
                                        rdm_state = RDM_STATE_PARAM_DATA;
                                    }
                                    else
                                    {
                                        rdm_state = RDM_STATE_CHECKSUM;
                                    }
                                    break;
                                }//end case RDM_STATE_PARAM_DATA_LEN

                                case RDM_STATE_PARAM_DATA:
                                {
                                    ScanaStudio.dec_item_new(channel,trame[i].start_sample_index,trame[i].end_sample_index);
                                    ScanaStudio.dec_item_add_content("Param Data " + rdm_pdl_cnt + " : " + trame[i].content);
                                    ScanaStudio.dec_item_add_content(trame[i].content);
                                    ScanaStudio.dec_item_end();
                                    ScanaStudio.hex_view_add_byte(channel, trame[i].start_sample_index, trame[i].end_sample_index, trame[i].content);
                                    ScanaStudio.packet_view_add_packet( false,
                                                                        channel,
                                                                        trame[i].start_sample_index,
                                                                        trame[i].end_sample_index,
                                                                        "PD" + rdm_pdl_cnt,
                                                                        trame[i].content,
                                                                        ScanaStudio.PacketColors.Data.Title,
                                                                        ScanaStudio.PacketColors.Data.Content);
                                    rdm_cnt_slots++;
                                    rdm_pdl_cnt++;
                                    rdm_chksum += parseInt(trame[i].content,16);

                                    if(rdm_pdl_cnt >= rdm_pdl)
                                    {
                                        tmp_byte_value = "0x";
                                        rdm_cnt_i = 0;
                                        rdm_state = RDM_STATE_CHECKSUM;
                                    }
                                    break;
                                }//end case RDM_STATE_PARAM_DATA

                                case RDM_STATE_CHECKSUM:
                                {
                                    tmp_byte_value += pad(parseInt( trame[i].content, 16).toString(16),2);

                                    rdm_cnt_i++;
                                    if(rdm_cnt_i>=2)
                                    {
                                        rdm_chksum = rdm_chksum%0x10000;

                                        ScanaStudio.dec_item_new(channel, sample_start_pkt, trame[i].end_sample_index);
                                        if(rdm_chksum == parseInt( tmp_byte_value, 16))
                                        {
                                            ScanaStudio.dec_item_emphasize_success();
                                            ScanaStudio.dec_item_add_content("CHECKSUM : " + tmp_byte_value);
                                            ScanaStudio.dec_item_add_content("ChkSm : " + tmp_byte_value);
                                            ScanaStudio.dec_item_add_content(tmp_byte_value);
                                            ScanaStudio.packet_view_add_packet( false,
                                                                                channel,
                                                                                sample_start_pkt,
                                                                                trame[i].end_sample_index,
                                                                                "CHECKSUM",
                                                                                tmp_byte_value,
                                                                                ScanaStudio.PacketColors.Check.Title,
                                                                                ScanaStudio.PacketColors.Check.Content);
                                        }
                                        else
                                        {
                                            ScanaStudio.dec_item_emphasize_error();
                                            ScanaStudio.dec_item_add_content("CHECKSUM : " + tmp_byte_value + " Should be 0x" + rdm_chksum.toString(16));
                                            ScanaStudio.dec_item_add_content("!ChkSm : " + tmp_byte_value);
                                            ScanaStudio.dec_item_add_content("!" + tmp_byte_value);
                                            ScanaStudio.packet_view_add_packet( false,
                                                                                channel,
                                                                                sample_start_pkt,
                                                                                trame[i].end_sample_index,
                                                                                "!CHECKSUM",
                                                                                tmp_byte_value + " Should be 0x" + rdm_chksum.toString(16),
                                                                                ScanaStudio.PacketColors.Error.Title,
                                                                                ScanaStudio.PacketColors.Error.Content);
                                        }
                                        ScanaStudio.dec_item_end();
                                        trame_started = false;
                                        rdm_state = RDM_STATE_START;
                                        rdm_cnt_i = 0;
                                        tmp_byte_value = "0x";
                                        sample_start_pkt = 0;
                                    }
                                    else if(rdm_cnt_i==1)
                                    {
                                        sample_start_pkt = trame[i].start_sample_index;
                                    }

                                    break;
                                }//end case RDM_STATE_CHECKSUM

                            }//end switch rdm_state
                        }
                        else if(trame_type == TRAME_DISCO) // Discovery frame
                        {
                            switch(rdm_state)
                            {
                                case DISCO_STATE_PREAMBLE:
                                {
                                    if(trame[i].content != "0xfe")
                                    {
                                        //error
                                    }

                                    rdm_cnt_i++;
                                    if(rdm_cnt_i>=6)
                                    {
                                        ScanaStudio.packet_view_add_packet( false,
                                                                            channel,
                                                                            sample_start_pkt,
                                                                            trame[i].end_sample_index,
                                                                            "Discovery answer",
                                                                            "Response Preamble bytes",
                                                                            ScanaStudio.PacketColors.Preamble.Title,
                                                                            ScanaStudio.PacketColors.Preamble.Content);

                                        ScanaStudio.dec_item_new(channel, sample_start_pkt, trame[i].end_sample_index);
                                        ScanaStudio.dec_item_add_content("Response Preamble bytes");
                                        ScanaStudio.dec_item_add_content("REP_Pre");
                                        ScanaStudio.dec_item_end();
                                        rdm_state = DISCO_STATE_SEP_PREAMBLE;
                                        rdm_cnt_i = 0;
                                        tmp_byte_value = "0x";
                                        sample_start_pkt = 0;
                                    }
                                    break;
                                }// end case DISCO_STATE_PREAMBLE

                                case DISCO_STATE_SEP_PREAMBLE:
                                {
                                    if(trame[i].content != "0xaa")
                                    {
                                        //error
                                    }
                                    ScanaStudio.packet_view_add_packet( false,
                                                                        channel,
                                                                        trame[i].start_sample_index,
                                                                        trame[i].end_sample_index,
                                                                        "Separator",
                                                                        trame[i].content,
                                                                        ScanaStudio.PacketColors.Preamble.Title,
                                                                        ScanaStudio.PacketColors.Preamble.Content);

                                    ScanaStudio.dec_item_new(channel, trame[i].start_sample_index, trame[i].end_sample_index);
                                    ScanaStudio.dec_item_add_content("Separator");
                                    ScanaStudio.dec_item_add_content("Sep");
                                    ScanaStudio.dec_item_end();
                                    rdm_state = DISCO_STATE_MAN_ID;
                                    rdm_cnt_i = 0;
                                    tmp_byte_value = 0;
                                    sample_start_pkt = 0;
                                    rdm_chksum = 0;
                                    break;
                                }// end case DISCO_STATE_SEP_PREAMBLE

                                case DISCO_STATE_MAN_ID:
                                {
                                    tmp_byte_value |= ((0x55 << ((rdm_cnt_i) % 2)) & parseInt(trame[i].content,16)) << (rdm_cnt_i<2? 8 : 0);

                                    // rdm_chksum += ((0x55 << ((rdm_cnt_i) % 2)) & parseInt(trame[i].content,16));
                                    rdm_chksum += parseInt(trame[i].content,16);

                                    rdm_cnt_i++;
                                    if(rdm_cnt_i>=4)
                                    {
                                        ScanaStudio.packet_view_add_packet( false,
                                                                            channel,
                                                                            sample_start_pkt,
                                                                            trame[i].end_sample_index,
                                                                            "Manufacturer ID",
                                                                            "0x" + tmp_byte_value.toString(16),
                                                                            ScanaStudio.PacketColors.Head.Title,
                                                                            ScanaStudio.PacketColors.Head.Content);

                                        ScanaStudio.dec_item_new(channel, sample_start_pkt, trame[i].end_sample_index);
                                        ScanaStudio.dec_item_add_content("Manufacturer ID : 0x" + tmp_byte_value.toString(16));
                                        ScanaStudio.dec_item_add_content("ManID 0x" + tmp_byte_value.toString(16));
                                        ScanaStudio.dec_item_add_content("0x" + tmp_byte_value.toString(16));
                                        ScanaStudio.dec_item_end();
                                        rdm_state = DISCO_STATE_DEV_ID;
                                        rdm_cnt_i = 0;
                                        tmp_byte_value = "0x";
                                        sample_start_pkt = 0;
                                    }
                                    else if(rdm_cnt_i == 1)
                                    {
                                        sample_start_pkt = trame[i].start_sample_index;
                                    }
                                    break;
                                }// end case DISCO_STATE_MAN_ID

                                case DISCO_STATE_DEV_ID:
                                {
                                    tmp_byte_value |= ((0x55 << ((rdm_cnt_i) % 2)) & parseInt(trame[i].content,16)) << (24 - 8*Math.round((rdm_cnt_i-1)/2));

                                    // rdm_chksum += ((0x55 << ((rdm_cnt_i) % 2)) & parseInt(trame[i].content,16));
                                    rdm_chksum += parseInt(trame[i].content,16);

                                    rdm_cnt_i++;
                                    if(rdm_cnt_i>=8)
                                    {
                                        ScanaStudio.packet_view_add_packet( false,
                                                                            channel,
                                                                            sample_start_pkt,
                                                                            trame[i].end_sample_index,
                                                                            "Device ID",
                                                                            "0x" + tmp_byte_value.toString(16),
                                                                            ScanaStudio.PacketColors.Data.Title,
                                                                            ScanaStudio.PacketColors.Data.Content);

                                        ScanaStudio.dec_item_new(channel, sample_start_pkt, trame[i].end_sample_index);
                                        ScanaStudio.dec_item_add_content("Device ID : 0x" + tmp_byte_value.toString(16));
                                        ScanaStudio.dec_item_add_content("DevID 0x" + tmp_byte_value.toString(16));
                                        ScanaStudio.dec_item_add_content("0x" + tmp_byte_value.toString(16));
                                        ScanaStudio.dec_item_end();
                                        rdm_state = DISCO_STATE_CHECKSUM;
                                        rdm_cnt_i = 0;
                                        tmp_byte_value = "0x";
                                        sample_start_pkt = 0;
                                    }
                                    else if(rdm_cnt_i == 1)
                                    {
                                        sample_start_pkt = trame[i].start_sample_index;
                                    }
                                    break;
                                }// end case DISCO_STATE_DEV_ID2

                                case DISCO_STATE_CHECKSUM:
                                {
                                    tmp_byte_value |= ((0x55 << ((rdm_cnt_i) % 2)) & parseInt(trame[i].content,16)) << (8 - 8*Math.round((rdm_cnt_i-1)/2));

                                    rdm_cnt_i++;
                                    if(rdm_cnt_i>=4)
                                    {
                                        ScanaStudio.dec_item_new(channel, sample_start_pkt, trame[i].end_sample_index);
                                        if(rdm_chksum == tmp_byte_value)
                                        {
                                            ScanaStudio.dec_item_emphasize_success();
                                            ScanaStudio.dec_item_add_content("CHECKSUM : 0x" + tmp_byte_value.toString(16));
                                            ScanaStudio.dec_item_add_content("ChkSm : 0x" + tmp_byte_value.toString(16));
                                            ScanaStudio.dec_item_add_content("0x" + tmp_byte_value.toString(16));
                                            ScanaStudio.packet_view_add_packet( false,
                                                                                channel,
                                                                                sample_start_pkt,
                                                                                trame[i].end_sample_index,
                                                                                "CHECKSUM",
                                                                                "0x" + tmp_byte_value.toString(16),
                                                                                ScanaStudio.PacketColors.Check.Title,
                                                                                ScanaStudio.PacketColors.Check.Content);
                                        }
                                        else
                                        {
                                            ScanaStudio.dec_item_emphasize_error();
                                            ScanaStudio.dec_item_add_content("CHECKSUM : " + "0x" + tmp_byte_value.toString(16) + " Should be 0x" + rdm_chksum.toString(16));
                                            ScanaStudio.dec_item_add_content("!ChkSm : " + "0x" + tmp_byte_value.toString(16));
                                            ScanaStudio.dec_item_add_content("!" + "0x" + tmp_byte_value.toString(16));
                                            ScanaStudio.packet_view_add_packet( false,
                                                                                channel,
                                                                                sample_start_pkt,
                                                                                trame[i].end_sample_index,
                                                                                "!CHECKSUM",
                                                                                "0x" + tmp_byte_value.toString(16) + " Should be 0x" + rdm_chksum.toString(16),
                                                                                ScanaStudio.PacketColors.Error.Title,
                                                                                ScanaStudio.PacketColors.Error.Content);
                                        }
                                        ScanaStudio.dec_item_end();
                                        rdm_state = RDM_STATE_START;
                                        trame_started = false;
                                        rdm_cnt_i = 0;
                                        tmp_byte_value = "0x";
                                        sample_start_pkt = 0;
                                    }
                                    else if(rdm_cnt_i == 1)
                                    {
                                        sample_start_pkt = trame[i].start_sample_index;
                                    }
                                    break;
                                }// end case DISCO_STATE_CHECKSUM


                            }//end switch rdm_state
                        }
                        else // Standard DMX or unrecognized frame
                        {
                            trame_started = false;
                            ScanaStudio.dec_item_new(channel,trame[i].start_sample_index,trame[i].end_sample_index);
                            ScanaStudio.dec_item_add_content(trame[i].content);
                            ScanaStudio.dec_item_end();
                            ScanaStudio.hex_view_add_byte(channel, trame[i].start_sample_index, trame[i].end_sample_index, trame[i].content);
                            ScanaStudio.packet_view_add_packet( false,
                                                                channel,
                                                                trame[i].start_sample_index,
                                                                trame[i].end_sample_index,
                                                                "Chan " + i,
                                                                trame[i].content,
                                                                ScanaStudio.PacketColors.Data.Title,
                                                                ScanaStudio.PacketColors.Data.Content);
                        }
                    }//end data bytes
                }//end for each item in trame
                last_i = i;
            }//end if trame ended
        }//end if trame started
    }//end for each uart item
}

function on_build_demo_signals()
{
    var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
    var dmx512_builder = ScanaStudio.BuilderObject;
    reload_dec_gui_values();
    dmx512_builder.config(channel, ScanaStudio.builder_get_sample_rate());

    var frame = [];

    for(var i = 0; i<512; i++)
    {
        frame.push(0);
    }

    frame[14] = 45;
    frame[15] = 1;
    frame[16] = 2;
    frame[20] = 54;

    while( ScanaStudio.builder_get_samples_acc(channel) < samples_to_build )
    {
        dmx512_builder.put_silence(0.01);
        dmx512_builder.put_DMX_frame(frame);

        dmx512_builder.put_silence(0.01);
        var substart = 0x01;
        var dest_uid = [0x12, 0x34, 0x56, 0x78, 0x9A, 0xBC];
        var src_uid = [0xCB, 0xA9, 0x87, 0x65, 0x43, 0x21];
        var transa_num = 0x0;
        var port_id_rep = 0x01;
        var subdev = 0x0000;
        var command_class = 0x20;
        var param_id = 0x0030;
        var param = [0x01];
        dmx512_builder.put_RDM_frame(substart, dest_uid, src_uid, transa_num, port_id_rep, subdev, command_class, param_id, param);
    }
}

//Builder object that can be shared to other scripts
ScanaStudio.BuilderObject = {
    rng : false,

    config : function(ch, sample_rate)
    {
        this.channel = ch;
        this.sample_rate = sample_rate;
    },

    put_silence : function (duration_s)
    {
        var samples_count = duration_s*this.sample_rate;
        if (samples_count == 0)
            samples_count = 1;

        ScanaStudio.builder_add_samples(this.channel, 1, samples_count);
    },

    put_break : function()
    {
        var duration_s;
        if(this.rng)
            duration_s = Math.random()*(CONST_t_break_max - CONST_t_break_min) + CONST_t_break_min;
        else
            duration_s = CONST_t_break_type;
        ScanaStudio.builder_add_samples(this.channel, 0, duration_s * this.sample_rate);
    },

    put_MAB : function()
    {
        var duration_s;
        if(this.rng)
            duration_s = Math.random()*(CONST_t_MAB_max - CONST_t_MAB_min) + CONST_t_MAB_min;
        else
            duration_s = CONST_t_MAB_type;
        ScanaStudio.builder_add_samples(this.channel, 1, duration_s * this.sample_rate);
    },

    put_MTBF : function()
    {
        var duration_s;
        if(this.rng)
            duration_s = Math.random()*(CONST_t_MTBF_max - CONST_t_MTBF_min) + CONST_t_MTBF_min;
        else
            duration_s = CONST_t_MTBF_min;
        ScanaStudio.builder_add_samples(this.channel, 1, duration_s * this.sample_rate);
    },

    put_MTBP : function()
    {
        var duration_s;
        if(this.rng)
            duration_s = Math.random()*(CONST_t_MTBP_max - CONST_t_MTBP_min) + CONST_t_MTBP_min;
        else
            duration_s = CONST_t_MTBP_min;
        ScanaStudio.builder_add_samples(this.channel, 1, duration_s * this.sample_rate);
    },

    put_bit : function(bit_val)
    {
        var duration_s;
        if(this.rng)
            duration_s = ((Math.random()*2 - 1) * CONST_time_tolerance + 1) * CONST_t_bit; // CONST_t_bit +/- CONST_time_tolerance
        else
            duration_s = CONST_t_bit;
        ScanaStudio.builder_add_samples(this.channel, bit_val, duration_s * this.sample_rate);
    },

    put_word : function(byte_val)
    {
        //put start bit
        this.put_bit(0);

        //put data
        for(var i=0; i<8; i++)
        {
            this.put_bit( (byte_val>>i) & 0x01 ); //LSB first
        }

        //put 2 stop bit
        this.put_bit(1);
        this.put_bit(1);

    },

    put_mword : function(byte_val)
    {
        this.put_MTBF();
        this.put_word(byte_val);
        return byte_val;
    },

    put_start_DMX_frame : function()
    {
        this.put_word(0);
        return 0x00;
    },

    put_start_RDM_frame : function()
    {
        this.put_word(0xcc);
        return 0xcc;
    },

    put_DMX_frame : function(frame)
    {
        this.put_break();
        this.put_MAB();

        // this.put_MTBF();
        this.put_start_DMX_frame();

        for(var i=0; i<frame.length; i++)
        {
            this.put_mword(frame[i]);
        }

        this.put_MTBP();
    },

    put_RDM_frame : function(substart, dest_uid, src_uid, transaction_number, port_id_rep, subdev, command_class, param_id, param)
    {
        this.put_break();
        this.put_MAB();

        var chksum = 0
        var msg_len = 24 + param.length;

        // this.put_MTBF();
        chksum += this.put_start_RDM_frame();

        chksum += this.put_mword(substart);//substart

        chksum += this.put_mword(msg_len);//message len : slot number of Checksum Hi (24 to 255)

        //Destination UID
        for(var i=0; i<6; i++)
        {
            chksum += this.put_mword(dest_uid[i]);
        }

        //Source UID
        for(var i=0; i<6; i++)
        {
            chksum += this.put_mword(src_uid[i]);
        }

        chksum += this.put_mword(transaction_number);//transaction number

        chksum += this.put_mword(port_id_rep);//Port ID/response type

        chksum += this.put_mword(0);//Message count

        chksum += this.put_mword((subdev>>8)&0xFF);//Subdevice
        chksum += this.put_mword(subdev&0xFF);

        chksum += this.put_mword(command_class);//Command Class (CC)

        chksum += this.put_mword((param_id>>8)&0xFF);//Parametre ID (PID)
        chksum += this.put_mword(param_id&0xFF);

        chksum += this.put_mword(param.length);//Parametre Data Length (0 to 231)

        //Parametre Data
        for(var i=0; i<param.length; i++)
        {
            chksum += this.put_mword(param[i]);
        }

        chksum = chksum%0x10000;

        this.put_mword((chksum>>8)&0xFF);//cheksum hi
        this.put_mword(chksum&0xFF);//checksum lo

        this.put_MTBP();
    }
};


function pad(num_str, size) {
    while (num_str.length < size) num_str = "0" + num_str;
    return num_str;
}
