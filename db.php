<?php
$DB_HOST = 'localhost';
$DB_NAME = 'u956762994_kapbot';
$DB_USER = 'u956762994_kapbot';
$DB_PASS = 'CHANGE_THIS_TO_YOUR_HOSTINGER_DB_PASSWORD';

$conn = new mysqli($DB_HOST, $DB_USER, $DB_PASS, $DB_NAME);

if ($conn->connect_error) {
    die('Database connection failed: ' . $conn->connect_error);
}
?>
