# AppJS

## Create System Service
:warning: In the following terminal commands you need to change \<app_name\> to the correct app name!  

First copy app.service file:
```
cp app.service <app_name>.service
```

Now you need to change \<app_name\> in the copied .service file:
```
sed -i 's/<app_name>/<my_real_app_name>/g' <app_name>.service
```

Now you need to change \<user\> in the copied .service file:
```
sed -i 's/<user>/<my_real_user>/g' <app_name>.service
```

Now you need to change \<description\> in the copied .service file:
```
sed -i 's/<description>/<my_real_description>/g' <app_name>.service
```

Now move \<app_name\>.service file to system:
```
sudo mv <app_name>.service /etc/systemd/system/
```

Then enable the system service:
```
sudo systemctl enable <app_name>.service
```

Finaly the system service needs to be started:
```
sudo systemctl start <app_name>.service
```