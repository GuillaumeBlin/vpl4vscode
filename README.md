# vpl4vscode README

The vpl4vscode extension allows to interact with VPL moodle's webservice directly from VSCode.

# modification on Moodle VPL plugin

In [externallib.php](https://github.com/jcrodriguez-dis/moodle-mod_vpl/blob/v3.3.8/externallib.php), add the following code to the end of file in order to allow run and debug as VPL webservices

```php
   /*
     * run function. run the student's submitted files
     */
    public static function run_parameters() {
        return new external_function_parameters( array (
                'id' => new external_value( PARAM_INT, 'Activity id (course_module)', VALUE_REQUIRED ),
                'password' => new external_value( PARAM_RAW, 'Activity password', VALUE_DEFAULT, '' )
        ) );
    }
    
    public static function run($id, $password) {
        global $USER;
        $params = self::validate_parameters( self::evaluate_parameters(), array (
                'id' => $id,
                'password' => $password
        ) );
        $vpl = self::initial_checks( $id, $password );
        $vpl->require_capability( VPL_SUBMIT_CAPABILITY );
        $instance = $vpl->get_instance();
        if (! $vpl->is_submit_able()) {
            throw new Exception( get_string( 'notavailable' ) );
        }
        if ($instance->example or ! $instance->run) {
            throw new Exception( get_string( 'notavailable' ) );
        }
        $res = mod_vpl_edit::execute( $vpl, $USER->id, 'run' );
        if ( empty($res->monitorPath) ) {
            throw new Exception( get_string( 'notavailable' ) );
        }
        $monitorurl = 'ws://' . $res->server . ':' . $res->port . '/' . $res->monitorPath;
        $smonitorurl = 'wss://' . $res->server . ':' . $res->securePort . '/' . $res->monitorPath;
        $executeurl = 'ws://' . $res->server . ':' . $res->port . '/' . $res->executionPath;
        $sexecuteurl = 'wss://' . $res->server . ':' . $res->securePort . '/' . $res->executionPath;
        return array ( 'monitorURL' => $monitorurl, 'smonitorURL' => $smonitorurl,'executeURL' => $executeurl, 'sexecuteURL' => $sexecuteurl  );
    }

    public static function run_returns() {
        return new external_single_structure( array (
            'monitorURL' => new external_value( PARAM_RAW, 'URL to the service that monitor the evaluation in the jail server' ),
            'smonitorURL' => new external_value( PARAM_RAW, 'URL to the service that monitor the evaluation in the jail server' ),
            'executeURL' => new external_value( PARAM_RAW, 'URL to the service that execute the evaluation in the jail server'),
            'sexecuteURL' => new external_value( PARAM_RAW, 'URL to the service that execute the evaluation in the jail server')
        ) );
    }

   /*
     * debug function. debug the student's submitted files
     */
    public static function debug_parameters() {
        return new external_function_parameters( array (
                'id' => new external_value( PARAM_INT, 'Activity id (course_module)', VALUE_REQUIRED ),
                'password' => new external_value( PARAM_RAW, 'Activity password', VALUE_DEFAULT, '' )
        ) );
    }
    
    public static function debug($id, $password) {
        global $USER;
        $params = self::validate_parameters( self::evaluate_parameters(), array (
                'id' => $id,
                'password' => $password
        ) );
        $vpl = self::initial_checks( $id, $password );
        $vpl->require_capability( VPL_SUBMIT_CAPABILITY );
        $instance = $vpl->get_instance();
        if (! $vpl->is_submit_able()) {
            throw new Exception( get_string( 'notavailable' ) );
        }
        if ($instance->example or ! $instance->debug) {
            throw new Exception( get_string( 'notavailable' ) );
        }
        $res = mod_vpl_edit::execute( $vpl, $USER->id, 'debug' );
        if ( empty($res->monitorPath) ) {
            throw new Exception( get_string( 'notavailable' ) );
        }
        $monitorurl = 'ws://' . $res->server . ':' . $res->port . '/' . $res->monitorPath;
        $smonitorurl = 'wss://' . $res->server . ':' . $res->securePort . '/' . $res->monitorPath;
        $executeurl = 'ws://' . $res->server . ':' . $res->port . '/' . $res->executionPath;
        $sexecuteurl = 'wss://' . $res->server . ':' . $res->securePort . '/' . $res->executionPath;
        return array ( 'monitorURL' => $monitorurl, 'smonitorURL' => $smonitorurl, 'executeURL' => $executeurl, 'sexecuteURL' => $sexecuteurl  );
    }

    public static function debug_returns() {
        return new external_single_structure( array (
            'monitorURL' => new external_value( PARAM_RAW, 'URL to the service that monitor the evaluation in the jail server' ),
            'smonitorURL' => new external_value( PARAM_RAW, 'URL to the service that monitor the evaluation in the jail server' ),
            'executeURL' => new external_value( PARAM_RAW, 'URL to the service that execute the evaluation in the jail server'),
            'sexecuteURL' => new external_value( PARAM_RAW, 'URL to the service that execute the evaluation in the jail server')
        ) );
    }
 ```
 
 In [view.php](https://github.com/jcrodriguez-dis/moodle-mod_vpl/blob/v3.3.8/view.php), replace
```php
if (vpl_get_webservice_available()) {
    echo "<a href='views/show_webservice.php?id=$id'>";
    echo get_string( 'webservice', 'core_webservice' ) . '</a><br>';
}
```

by 

```php
if (vpl_get_webservice_available()) {
    $service_url = vpl_get_webservice_urlbase($vpl);
    echo '<a href="vscode://GuillaumeBlin.vpl4vscode/open?’.$service_url.’" class="btn btn-primary">Import in VS Code</a>'

}
```
 
## Known Issues

Completely in beta test



