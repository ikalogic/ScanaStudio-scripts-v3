/* Protocol meta info:
<NAME> I2C scanner</NAME>
<DESCRIPTION>
This signal builder can be used to generate a series of I2C address calls
to scan the whole range of possible addresses. This can be useful to test
a number of I2C devices and see which addresses are acknowledged.
</DESCRIPTION>
<VERSION> 0.2 </VERSION>
<AUTHOR_NAME> Ibrahim KAMAL </AUTHOR_NAME>
<AUTHOR_URL> i.kamal@ikalogic.com, v.canoz@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright Ibrahim KAMAL </COPYRIGHT>
<LICENSE> This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.2:  Added description.
V0.1:  Initial release.
</RELEASE_NOTES>
*/


//Signal builder GUI
function on_draw_gui_signal_builder()
{
  ScanaStudio.gui_add_ch_selector("ch_sda","SDA Channel","SDA");
  ScanaStudio.gui_add_ch_selector("ch_scl","SCL Channel","SCL");
  ScanaStudio.gui_add_engineering_form_input_box("i2c_freq","I2C clock frequency",10,3.4e6,100e3,"Hz");
  ScanaStudio.gui_add_check_box("skip_addresses","Skip reserved I2C adddresses",true);
}

//Evaluate signal builder GUI (optionnal)
function on_eval_gui_signal_builder()
{
  i2c_freq = ScanaStudio.gui_get_value("i2c_freq");
  if (i2c_freq >= ScanaStudio.builder_get_sample_rate()/10)
  {
    return "I2C frequency is too high. The maximum value for the current sampling rate is: "
    + ScanaStudio.engineering_notation(ScanaStudio.builder_get_sample_rate()/10,3) + "Hz";
  }
  return ""; //All good.
}

var ch_sda,ch_scl,i2c_freq,skip_addresses;
//Function called to build siganls (to be generate by capable device)
function on_build_signals()
{
  //Use the function below to get the number of samples to be built
  var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
  var builder = ScanaStudio.load_builder_object("i2c.js");
  var silence_period = 10*ScanaStudio.builder_get_sample_rate()/i2c_freq; //10 clock silence period
  ch_sda = ScanaStudio.gui_get_value("ch_sda");
  ch_scl = ScanaStudio.gui_get_value("ch_scl");
  i2c_freq = ScanaStudio.gui_get_value("i2c_freq");
  skip_addresses = ScanaStudio.gui_get_value("skip_addresses");
  builder.config(ch_scl,ch_sda,i2c_freq);

  for (var i = 0; i < 127; i++)
  {
    var address = (i<<1)&0xFF;
    if (skip_addresses)
    {
      if ((i == 0)
      || (i == 1)
      || (i == 2)
      || (i == 3)
      || ((i & 0x7C )==4)
      || ((i & 0x7C )==0x7C)
      || ((i & 0x7C )==0x78) )
      {
        continue; //Skip those addresses.
      }
    }

    builder.put_silence(silence_period);
    builder.put_start();
    builder.put_byte(address,1);
    builder.put_stop();
    builder.put_silence(silence_period);
  }
}
