package Cpanel::API::EKABuilder;

# UAPI for the EKA Website Builder plugin page: asks the root-run AdminBin
# for a one-time sign-in link for the logged-in cPanel user.

use strict;
use warnings;

our $VERSION = '1.0';

use Cpanel::AdminBin::Call ();

our %API = ( sso => { needs_feature => 'eka_builder' } );

sub sso {
    my ( $args, $result ) = @_;
    my $url = Cpanel::AdminBin::Call::call( 'EKA', 'Builder', 'SSO' );
    $result->data( { url => $url } );
    return 1;
}

1;
