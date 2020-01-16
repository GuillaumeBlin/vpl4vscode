# VPL4VSCODE 

![VPL Logo](https://github.com/GuillaumeBlin/vplbdx/raw/master/misc/img/VPLBDXLOGO.png)

The VPL4VSCODE project is  ...
[truc](https://truc.com) 

# Requirements
 

blablabl **vplbdx.conf** in 

![Overall architecture](https://github.com/GuillaumeBlin/vplbdx/raw/master/misc/img/VPLBDX.png)



```shell
    git clone https://github.com/GuillaumeBlin/vplbdx.git 
````

Once again, you will have to replace `MANAGER_IP` and `PROXY_PORT` such that `MANAGER_IP` is an ip for **manager** machine that is *accessible only* (if you want to straighten the security - *accessible* if you do not care) from the moodle server and `PROXY_PORT` is the value you set in the `.env` file. Moreover, your certifacte files (here `secure.crt` and `secure.key`) should be present in `/etc/nginx/` folder.
