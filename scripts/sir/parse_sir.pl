#!/usr/bin/perl
use strict; use warnings;
# usage: parse_sir.pl <unzipped_dir> <date YYYY-MM-DD>
my ($dir,$date)=@ARGV;
$date //= "unknown";

# ---- shared strings ----
my @S;
{
  local $/; open my $fh,'<:raw',"$dir/xl/sharedStrings.xml" or die "no sharedStrings: $!";
  my $x=<$fh>; close $fh;
  while($x=~/<si>(.*?)<\/si>/gs){
    my $si=$1; my $t='';
    $t.=$1 while $si=~/<t[^>]*>(.*?)<\/t>/gs;
    $t=~s/&amp;/&/g; $t=~s/&lt;/</g; $t=~s/&gt;/>/g; $t=~s/&quot;/"/g; $t=~s/&#39;/'/g;
    push @S,$t;
  }
}

# ---- sheet ----
local $/; open my $fh,'<:raw',"$dir/xl/worksheets/sheet1.xml" or die "no sheet: $!";
my $sheet=<$fh>; close $fh;

sub cellval {
  my ($c)=@_;
  my ($t)= $c=~/\bt="([^"]+)"/;
  my ($v)= $c=~/<v>(.*?)<\/v>/s;
  return "" unless defined $v;
  if(defined $t && $t eq 's'){ return $S[$v] // ""; }
  if(defined $t && $t eq 'str'){ return $v; }
  # numeric: drop trailing .0, keep integers as ints
  if($v=~/^-?\d+(?:\.0+)?$/){ $v=~s/\.0+$//; return $v+0; }
  if($v=~/^-?\d*\.\d+$/){ return $v+0; }
  return $v;
}
sub colletter { my($r)=@_; $r=~/^([A-Z]+)/; return $1; }

my @rows;
while($sheet=~/<row[^>]*\br="(\d+)"[^>]*>(.*?)<\/row>/gs){
  my ($rn,$body)=($1,$2);
  my %cells;
  while($body=~/(<c\b[^>]*\br="([A-Z]+\d+)"[^>]*(?:\/>|>.*?<\/c>))/gs){
    my ($cell,$ref)=($1,$2);
    $cells{colletter($ref)}=cellval($cell);
  }
  push @rows, { rn=>$rn, cells=>\%cells };
}

# header row = first row
my $hdr = shift @rows;
my %colName; # letter -> header
for my $L (sort keys %{$hdr->{cells}}){ $colName{$L}=$hdr->{cells}{$L}; }
my @letters = sort { length($a)<=>length($b) || $a cmp $b } keys %colName;
my @columns = map { $colName{$_} } @letters;

# classify
my %label = map {$_=>1} ("State Name","District Number","District Name","AC Number","Asmbly Name","Part Number");
my @key = ("AC Number","Part Number");
my @metrics = grep { !$label{$_} } @columns;

# json escape
sub js { my($s)=@_; $s=~s/\\/\\\\/g; $s=~s/"/\\"/g; $s=~s/\n/ /g; return $s; }

# emit JSON
my @out;
for my $r (@rows){
  my @kv;
  for my $L (@letters){
    my $name=$colName{$L};
    my $v=$r->{cells}{$L};
    $v="" unless defined $v;
    if($v=~/^-?\d+(\.\d+)?$/){ push @kv, '"'.js($name).'":'.($v+0); }
    else { push @kv, '"'.js($name).'":"'.js($v).'"'; }
  }
  push @out, "    {".join(",",@kv)."}";
}
my $cols=join(",", map {'"'.js($_).'"'} @columns);
my $keys=join(",", map {'"'.js($_).'"'} @key);
my $mets=join(",", map {'"'.js($_).'"'} @metrics);
print "{\n";
print '  "date":"'.$date.'",'."\n";
print '  "source":"Karnataka_SIR_PART_WISE",'."\n";
print '  "sheet":"EnumFormTracking",'."\n";
print '  "key":['.$keys.'],'."\n";
print '  "labels":["State Name","District Number","District Name","AC Number","Asmbly Name","Part Number"],'."\n";
print '  "metrics":['.$mets.'],'."\n";
print '  "columns":['.$cols.'],'."\n";
print '  "rows":['."\n".join(",\n",@out)."\n  ]\n";
print "}\n";
