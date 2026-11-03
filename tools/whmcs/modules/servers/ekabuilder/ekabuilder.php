<?php
/**
 * EKA Website Builder: WHMCS provisioning module.
 *
 * Creates a builder customer when a product is ordered, suspends,
 * unsuspends and removes them with the service, changes their plan on
 * upgrade, and gives customers a "Open Website Builder" button that signs
 * them straight in.
 *
 * Set up a server in WHMCS (System Settings > Servers): Module "EKA Website
 * Builder", Hostname = the builder's address (e.g. builder.yourhost.com),
 * Password = the host API key from the builder's Customers page, and tick
 * "Secure" for https. Then on the product's Module Settings tab, pick this
 * module and enter the builder plan (e.g. "starter").
 */

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

function ekabuilder_MetaData()
{
    return array(
        'DisplayName' => 'EKA Website Builder',
        'APIVersion' => '1.1',
        'RequiresServer' => true,
        'ServiceSingleSignOnLabel' => 'Open Website Builder',
    );
}

function ekabuilder_ConfigOptions()
{
    return array(
        'Plan' => array('Type' => 'text', 'Size' => '25', 'Description' => 'Builder plan id or name, e.g. starter'),
        'On suspend' => array('Type' => 'dropdown', 'Options' => 'Keep websites online,Take websites offline', 'Description' => 'What happens to their live websites'),
        'On terminate' => array('Type' => 'dropdown', 'Options' => 'Delete websites,Keep websites (as yours)', 'Description' => 'What happens to their websites'),
    );
}

/** Calls the builder's host API. Returns the decoded answer or throws. */
function ekabuilder_call(array $params, $method, $path, array $body = null)
{
    $host = trim($params['serverhostname'] ?: $params['serverip']);
    $host = preg_replace('#^https?://#i', '', rtrim($host, '/'));
    $scheme = !empty($params['serversecure']) ? 'https' : 'http';
    $port = !empty($params['serverport']) ? ':' . (int) $params['serverport'] : '';
    $url = "$scheme://$host$port/api/host$path";

    $ch = curl_init($url);
    $opts = array(
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => array('Content-Type: application/json', 'Authorization: Bearer ' . $params['serverpassword']),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
    );
    if ($body !== null) $opts[CURLOPT_POSTFIELDS] = json_encode($body);
    curl_setopt_array($ch, $opts);
    $raw = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = $raw === false ? curl_error($ch) : '';
    curl_close($ch);
    $data = json_decode((string) $raw, true);

    // The key is never logged.
    logModuleCall('ekabuilder', "$method $path", $body, $raw, $data, array($params['serverpassword']));
    if ($error) throw new Exception("Couldn't reach the builder: $error");
    if ($status < 200 || $status >= 300) throw new Exception(isset($data['error']) ? $data['error'] : "The builder answered $status.");
    return is_array($data) ? $data : array();
}

/** The customer, as the builder knows them: one per WHMCS service. */
function ekabuilder_account(array $params)
{
    $c = $params['clientsdetails'];
    $name = trim($c['companyname']) !== '' ? $c['companyname'] : trim($c['firstname'] . ' ' . $c['lastname']);
    $account = array('account' => 'whmcs:service:' . $params['serviceid'], 'email' => $c['email'], 'name' => $name);
    if (trim($params['configoption1']) !== '') $account['plan'] = trim($params['configoption1']);
    return $account;
}

function ekabuilder_CreateAccount(array $params)
{
    try {
        ekabuilder_call($params, 'POST', '/accounts', ekabuilder_account($params));
        return 'success';
    } catch (Exception $e) {
        return $e->getMessage();
    }
}

function ekabuilder_SuspendAccount(array $params)
{
    try {
        $body = array('account' => 'whmcs:service:' . $params['serviceid'], 'email' => $params['clientsdetails']['email']);
        if ($params['configoption2'] === 'Take websites offline') $body['takeSitesOffline'] = true;
        ekabuilder_call($params, 'POST', '/accounts/suspend', $body);
        return 'success';
    } catch (Exception $e) {
        return $e->getMessage();
    }
}

function ekabuilder_UnsuspendAccount(array $params)
{
    try {
        ekabuilder_call($params, 'POST', '/accounts/unsuspend', array('account' => 'whmcs:service:' . $params['serviceid'], 'email' => $params['clientsdetails']['email']));
        return 'success';
    } catch (Exception $e) {
        return $e->getMessage();
    }
}

function ekabuilder_TerminateAccount(array $params)
{
    try {
        ekabuilder_call($params, 'POST', '/accounts/terminate', array(
            'account' => 'whmcs:service:' . $params['serviceid'],
            'email' => $params['clientsdetails']['email'],
            'keepSites' => $params['configoption3'] === 'Keep websites (as yours)',
        ));
        return 'success';
    } catch (Exception $e) {
        return $e->getMessage();
    }
}

function ekabuilder_ChangePackage(array $params)
{
    try {
        ekabuilder_call($params, 'POST', '/accounts', ekabuilder_account($params));
        return 'success';
    } catch (Exception $e) {
        return $e->getMessage();
    }
}

function ekabuilder_TestConnection(array $params)
{
    try {
        ekabuilder_call($params, 'GET', '/plans');
        return array('success' => true, 'error' => '');
    } catch (Exception $e) {
        return array('success' => false, 'error' => $e->getMessage());
    }
}

function ekabuilder_ServiceSingleSignOn(array $params)
{
    try {
        $data = ekabuilder_call($params, 'POST', '/sso', ekabuilder_account($params));
        return array('success' => true, 'redirectTo' => $data['url']);
    } catch (Exception $e) {
        return array('success' => false, 'errorMsg' => $e->getMessage());
    }
}

function ekabuilder_ClientArea(array $params)
{
    return '<p>Your website builder is ready. Use <strong>Open Website Builder</strong> to sign in.</p>';
}
