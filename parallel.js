/* Protocol meta info:
<NAME> Parallel Bus </NAME>
<DESCRIPTION>

</DESCRIPTION>
<VERSION> 0.0 </VERSION>
<AUTHOR_NAME> Nicolas BASTIT </AUTHOR_NAME>
<AUTHOR_URL> n.bastit@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright Nicolas BASTIT </COPYRIGHT>
<LICENSE> This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.0:  Initial release.
</RELEASE_NOTES>
*/



//Global variables
var sampling_rate;
var dl_mode = [];
var bit_order;
var strobe;
var bit_sampling;
var trs;
var next_trs;
var ch_trs;
var ch_next_trs;
var data;
var format_hex, format_bin, format_ascii, format_dec;


//Decoder GUI
function on_draw_gui_decoder()
{
    var n_channel = ScanaStudio.get_device_channels_count();
    //Define decoder configuration GUI
    for(var i=1; i<=8; i++)
    {
        ScanaStudio.gui_add_combo_box("dl"+i,"Data Line " + i + " Channel");
            ScanaStudio.gui_add_item_to_combo_box("Not used", n_channel<i);
            ScanaStudio.gui_add_item_to_combo_box("Always high", false);
            ScanaStudio.gui_add_item_to_combo_box("Always low", false);
            for(var j=1; j<=n_channel; j++)
            {
                ScanaStudio.gui_add_item_to_combo_box("CH"+j, (n_channel>=i)&(i==j));
            }
    }

    ScanaStudio.gui_add_combo_box("bit_order","Bit Order");
        ScanaStudio.gui_add_item_to_combo_box("MSB first", false);
        ScanaStudio.gui_add_item_to_combo_box("LSB first", true);

    ScanaStudio.gui_add_combo_box("strobe","Strobe source");
        ScanaStudio.gui_add_item_to_combo_box("All data lines", false);
        for(var j=1; j<=n_channel; j++)
        {
            ScanaStudio.gui_add_item_to_combo_box("CH"+j,j==1);
        }

    ScanaStudio.gui_add_combo_box("bit_sampling","Bit sampling on");
        ScanaStudio.gui_add_item_to_combo_box("Level change", true);
        ScanaStudio.gui_add_item_to_combo_box("Falling edge", false);
        ScanaStudio.gui_add_item_to_combo_box("Rising edge", false);

    ScanaStudio.gui_add_new_tab("Output format",true);
        ScanaStudio.gui_add_check_box("format_hex","HEX",true);
        ScanaStudio.gui_add_check_box("format_ascii","ASCII",false);
        ScanaStudio.gui_add_check_box("format_dec","Unsigned decimal",false);
        ScanaStudio.gui_add_check_box("format_bin","Binary",false);
    ScanaStudio.gui_end_tab();

    reload_dec_gui_values();
}

//Evaluate decoder GUI
function on_eval_gui_decoder()
{
    return ""; //All good.
}

function reload_dec_gui_values()
{
    for(var i=1; i<=8; i++)
    {
        var tmp_mode =  Number(ScanaStudio.gui_get_value("dl"+i)) - 3;
        dl_mode.push(tmp_mode);
    }

    strobe =  Number(ScanaStudio.gui_get_value("strobe")) - 1;
    bit_sampling = Number(ScanaStudio.gui_get_value("bit_sampling")) - 1;
    bit_order = Number(ScanaStudio.gui_get_value("bit_order"));
    format_hex = Number(ScanaStudio.gui_get_value("format_hex"));
    format_dec = Number(ScanaStudio.gui_get_value("format_dec"));
    format_ascii = Number(ScanaStudio.gui_get_value("format_ascii"));
    format_bin = Number(ScanaStudio.gui_get_value("format_bin"));
}

function find_next_value()
{

}

function on_decode_signals(resume)
{
    if (!resume) //If resume == false, it's the first call to this function.
    {
        reload_dec_gui_values();

        if(strobe == -1)//all data line // not finished
        {
            ScanaStudio.console_error_msg("function not finished yet : all data change");
        //     //here code
        //     ch_trs = -1;
        //     ch_next_trs = -1;
        //
        //     for(var i=0; i<8; i++)
        //     {
        //         if(dl_mode[i]>=0)
        //         {
        //             var tmp_trs, tmp_next_trs;
        //             ScanaStudio.trs_reset(dl_mode[i]);
        //             tmp_trs = ScanaStudio.trs_get_next(dl_mode[i]);
        //             tmp_next_trs = ScanaStudio.trs_get_next(dl_mode[i]);
        //             if(ch_trs == -1)
        //             {
        //                 trs = tmp_trs;
        //                 ch_trs = i;
        //                 next_trs = tmp_next_trs;
        //                 ch_next_trs = i;
        //             }
        //
        //             if(trs.sample_index > tmp_trs.sample_index)
        //             {
        //                 trs = tmp_trs;
        //                 ch_trs = i;
        //             }
        //
        //             if((next_trs.sample_index > tmp_next_trs.sample_index)&&(trs.sample_index != tmp_next_trs.sample_index))
        //             {
        //                 next_trs = tmp_next_trs;
        //                 ch_next_trs = i;
        //             }
        //         }
        //     }
        }
        else
        {
            ScanaStudio.trs_reset(strobe);
            ScanaStudio.console_info_msg("bit_sampling :" + bit_sampling);
            if(bit_sampling == -1)
            {
                trs = ScanaStudio.trs_get_next(strobe);
                next_trs = ScanaStudio.trs_get_next(strobe);
            }
            else
            {
                trs = ScanaStudio.trs_get_next(strobe);

                while(trs.value != bit_sampling)
                {
                    trs = ScanaStudio.trs_get_next(strobe);
                    ScanaStudio.console_info_msg("trs.value :" + trs.value);
                }

                next_trs = ScanaStudio.trs_get_next(strobe);
                while(next_trs.value != bit_sampling)
                {
                    next_trs = ScanaStudio.trs_get_next(strobe);
                    ScanaStudio.console_info_msg("next_trs.value :" + next_trs.value);
                }
            }
        }
    }

    while (ScanaStudio.abort_is_requested() == false)
    {
        if(strobe == -1)//all data line //not finished
        {
            ScanaStudio.console_error_msg("function not finished yet : all data change");
            break;
        //     var need_stop = false;
        //     for(var i=0; i<8; i++)
        //     {
        //         if(dl_mode[i]>=0)
        //         {
        //             if(channel_to_decode == -1)
        //             {
        //                 channel_to_decode = dl_mode[i];
        //             }
        //
        //             if(!ScanaStudio.trs_is_not_last(dl_mode[i]))
        //             {
        //                 need_stop = true;
        //             }
        //         }
        //     }
        //
        //     if(need_stop)
        //     {
        //         ScanaStudio.console_info_msg("end",trs.sample_index);
        //         break;
        //     }
        //
        //     if(bit_sampling == -1)
        //     {
        //         trs = next_trs;
        //         ch_trs = ch_next_trs;
        //         for(var i=0; i<8; i++)
        //         {
        //             if(dl_mode[i]>=0)
        //             {
        //                 var tmp_trs, tmp_next_trs;
        //                 tmp_trs = ScanaStudio.trs_get_before(dl_mode[i],trs.sample_index);
        //                 if( (ch_trs != i)||(tmp_trs.sample_index != trs.sample_index) )
        //                 {
        //                     if(ScanaStudio.trs_is_not_last(dl_mode[i]))
        //                     {
        //                         tmp_trs = ScanaStudio.trs_get_next(dl_mode[i]);
        //                     }
        //                     else
        //                     {
        //                         continue;
        //                     }
        //                 }
        //                 if(ScanaStudio.trs_is_not_last(dl_mode[i]))
        //                 {
        //                     tmp_next_trs = ScanaStudio.trs_get_next(dl_mode[i]);
        //                 }
        //                 else
        //                 {
        //                     continue;
        //                 }
        //
        //                 if(trs.sample_index == next_trs.sample_index)
        //                 {
        //                     next_trs = tmp_next_trs;
        //                     ch_next_trs = i;
        //                 }
        //
        //                 if(next_trs.sample_index > tmp_next_trs.sample_index)
        //                 {
        //                     next_trs = tmp_next_trs;
        //                     ch_next_trs = i;
        //                 }
        //             }
        //         }
        //     }
        //     else
        //     {
        //         // trs = ScanaStudio.trs_get_next(strobe);
        //         // while( (ScanaStudio.trs_is_not_last(strobe))&&(trs.value != bit_sampling) )
        //         // {
        //         //     trs = next_trs;
        //         //     next_trs = ScanaStudio.trs_get_next(strobe);
        //         // }
        //     }
        //
        //
        }
        else
        {

            data = 0;
            for(var i=0; i<dl_mode.length; i++)
            {
                if(dl_mode[i] < 0)
                {
                    // set offset
                    if(dl_mode[i] == -2)//always high
                    {
                        if(bit_order == 0)//MSB
                        {
                            data = data | (1<<(7-i));
                        }
                        else //LSB
                        {
                            data = data | (1<<i);
                        }
                    }
                }
                else
                {
                    if(bit_order == 0)//MSB
                    {
                        data = data | (ScanaStudio.trs_get_before(dl_mode[i], trs.sample_index).value)<<(7-i);
                    }
                    else //LSB
                    {
                        data = data | (ScanaStudio.trs_get_before(dl_mode[i], trs.sample_index).value)<<i;
                    }
                }
            }
            ScanaStudio.dec_item_new(strobe, trs.sample_index, next_trs.sample_index);
            var content = "";
            if (format_hex)
            {
                content += "0x" + data.toString(16);
            }
            if (format_ascii)
            {
                content += " '" + String.fromCharCode(data) + "'";
            }
            if (format_dec)
            {
                content += " (" + data.toString(10) + ")";
            }
            if (format_bin)
            {
                content += " 0b" + data.toString(2);
            }
            ScanaStudio.dec_item_add_content(content);

            //Add a smaller version of the content field
            content = "";
            if  ((format_hex) && (content == ""))
            {
                content += "0x" + data.toString(16);
            }
            if ((format_ascii) && (content == ""))
            {
                content += " " + String.fromCharCode(data);
            }
            if ((format_dec) && (content == ""))
            {
                content += " " + data.toString(10) ;
            }
            if ((format_bin) && (content == ""))
            {
                content += " 0b" + data.toString(2);
            }
            ScanaStudio.dec_item_add_content(content);
            ScanaStudio.dec_item_end();

            ScanaStudio.hex_view_add_byte(strobe, trs.sample_index, next_trs.sample_index, data);

            if(!ScanaStudio.trs_is_not_last(strobe))
            {
                break;
            }

            if(bit_sampling == -1)
            {
                trs = next_trs;
                next_trs = ScanaStudio.trs_get_next(strobe);
            }
            else
            {
                trs = next_trs;
                next_trs = ScanaStudio.trs_get_next(strobe);
                if(ScanaStudio.trs_is_not_last(strobe))
                {
                    next_trs = ScanaStudio.trs_get_next(strobe);
                }
            }
        }
    }
}
