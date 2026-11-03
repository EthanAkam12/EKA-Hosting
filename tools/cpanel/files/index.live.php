<?php
// EKA Website Builder: the cPanel icon opens this page, which signs the
// user in to the builder and sends them there.
require_once "/usr/local/cpanel/php/cpanel.php";
$cpanel = new CPANEL();
$res = $cpanel->uapi('EKABuilder', 'sso');
$result = isset($res['cpanelresult']['result']) ? $res['cpanelresult']['result'] : array();
$url = isset($result['data']['url']) ? $result['data']['url'] : '';
if ($url !== '' && preg_match('#^https?://#i', $url)) {
    header('Location: ' . $url, true, 303);
    $cpanel->end();
    exit;
}
$errors = isset($result['errors']) && is_array($result['errors']) ? $result['errors'] : array('Unknown error');
print $cpanel->header('Website Builder');
print '<div class="body-content"><div class="alert alert-danger"><p><strong>The website builder couldn\'t be opened.</strong></p><p>'
    . htmlspecialchars(implode(' ', $errors), ENT_QUOTES, 'UTF-8')
    . '</p><p>Please try again in a minute, or contact your hosting provider.</p></div></div>';
print $cpanel->footer();
$cpanel->end();
